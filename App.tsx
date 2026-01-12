
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut,
  updateProfile
} from "firebase/auth";
import { 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  collection, 
  query, 
  where,
  updateDoc,
  arrayUnion,
  onSnapshot,
  addDoc,
  increment,
  Timestamp
} from "firebase/firestore";
import { GoogleGenAI } from "@google/genai";
import { auth, db } from './firebaseConfig';
import { 
  HomeIcon, 
  SearchIcon, 
  LibraryIcon, 
  ProfileIcon, 
  PlayIcon, 
  PauseIcon, 
  SettingsIcon,
  DownloadIcon,
  GiftIcon
} from './components/Icons';
import { Song, UserData, Dedication, CoinTransaction } from './types';
import { saveSongOffline, getAllOfflineSongs } from './services/indexedDB';

// --- INITIALIZE AI ---
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || "" });

// --- UTILS ---
const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

// --- SHARED COMPONENTS ---

const Toast = ({ message, onClose }: { message: string; onClose: () => void }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);
  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-purple-600 text-white px-6 py-3 rounded-2xl shadow-2xl z-[9999] text-sm font-bold animate-slide-up flex items-center gap-2 border border-white/20">
      <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
      {message}
    </div>
  );
};

// --- MAIN APP ---

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentTab, setCurrentTab] = useState('home');
  const [songs, setSongs] = useState<Song[]>([]);
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [isPlayerOpen, setIsPlayerOpen] = useState(false);
  const [isDedicateModalOpen, setIsDedicateModalOpen] = useState(false);
  const [songTrivia, setSongTrivia] = useState<string>('');
  const [isTriviaLoading, setIsTriviaLoading] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Sync state
  useEffect(() => {
    const savedSong = localStorage.getItem('last_played');
    if (savedSong) {
      try { setCurrentSong(JSON.parse(savedSong)); } catch (e) {}
    }
  }, []);

  const updateMediaMetadata = useCallback((song: Song) => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: song.title,
        artist: song.artist,
        artwork: [{ src: song.img, sizes: '512x512', type: 'image/png' }]
      });
      navigator.mediaSession.setActionHandler('play', () => { audioRef.current?.play(); setIsPlaying(true); });
      navigator.mediaSession.setActionHandler('pause', () => { audioRef.current?.pause(); setIsPlaying(false); });
    }
  }, []);

  const fetchTrivia = async (song: Song) => {
    if (!process.env.API_KEY) return;
    setIsTriviaLoading(true);
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Provide one extremely short, punchy trivia fact about "${song.title}" by "${song.artist}". Max 15 words.`,
      });
      setSongTrivia(response.text || "Exclusive track info loading...");
    } catch (error) {
      setSongTrivia("Exploring the sonic universe of this artist.");
    } finally {
      setIsTriviaLoading(false);
    }
  };

  useEffect(() => {
    if (currentSong && isPlayerOpen) fetchTrivia(currentSong);
  }, [currentSong?.id, isPlayerOpen]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (authUser) => {
      if (authUser) {
        setUser(authUser);
        const userRef = doc(db, 'users', authUser.uid);
        onSnapshot(userRef, (snap) => {
          if (snap.exists()) setUserData(snap.data() as UserData);
        });
      } else {
        setUser(null);
        setUserData(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (user) {
      const fetchSongs = async () => {
        const querySnapshot = await getDocs(collection(db, 'songs'));
        setSongs(querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Song)));
      };
      fetchSongs();
    }
  }, [user]);

  const handlePlay = (song: Song) => {
    if (currentSong?.id === song.id) {
      if (isPlaying) { audioRef.current?.pause(); setIsPlaying(false); }
      else { audioRef.current?.play(); setIsPlaying(true); }
    } else {
      setCurrentSong(song);
      localStorage.setItem('last_played', JSON.stringify(song));
      setIsPlaying(true);
      if (audioRef.current) {
        audioRef.current.src = song.url;
        audioRef.current.play().catch(console.error);
      }
      updateMediaMetadata(song);
    }
  };

  const processTransaction = async (amount: number, description: string, type: 'earn' | 'spend') => {
    if (!userData) return false;
    if (type === 'spend' && userData.coins < amount) {
      setToastMsg("Not enough coins! 🪙");
      return false;
    }
    const newTx: CoinTransaction = {
      id: Math.random().toString(36).substr(2, 9),
      type,
      amount,
      description,
      timestamp: Date.now()
    };
    const userRef = doc(db, 'users', userData.uid);
    await updateDoc(userRef, {
      coins: increment(type === 'earn' ? amount : -amount),
      coinHistory: arrayUnion(newTx)
    });
    return true;
  };

  const handleLike = async (songId: string) => {
    if (!userData) return;
    const isLiked = userData.likedSongs?.includes(songId);
    await updateDoc(doc(db, 'users', userData.uid), {
      likedSongs: isLiked ? userData.likedSongs.filter(id => id !== songId) : arrayUnion(songId)
    });
    setToastMsg(isLiked ? "Removed from Likes" : "Added to Likes ❤️");
  };

  const handleDownload = async (song: Song) => {
    if (!userData?.isPremium && userData?.coins! < 2) {
      setToastMsg("Need 2 coins to download (or upgrade to Premium)");
      return;
    }
    
    setToastMsg(`Preparing ${song.title}...`);
    try {
      const response = await fetch(song.url);
      const blob = await response.blob();
      await saveSongOffline(song.id, blob, { title: song.title, artist: song.artist, img: song.img });
      
      if (!userData?.isPremium) {
        await processTransaction(2, `Downloaded ${song.title}`, 'spend');
      }
      setToastMsg('Offline track secured! 🔒');
    } catch (error) {
      setToastMsg('Download failed.');
    }
  };

  if (loading) return (
    <div className="h-screen flex items-center justify-center bg-[#0a0a0a]">
      <div className="text-4xl font-black text-purple-500 animate-pulse tracking-tighter">MUSICO</div>
    </div>
  );

  if (!user) return <AuthScreen onToast={setToastMsg} />;

  return (
    <div className="flex flex-col h-screen bg-[#0a0a0a] overflow-hidden text-white">
      <audio 
        ref={audioRef} 
        onEnded={() => setIsPlaying(false)}
        onTimeUpdate={(e) => setAudioProgress(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setAudioDuration(e.currentTarget.duration)}
      />
      
      <header className="px-6 pt-8 pb-4 flex justify-between items-center bg-[#0a0a0a] z-10">
        <div className="flex flex-col">
          <span className="text-2xl font-black text-purple-500 tracking-tighter leading-none">MUSICO</span>
          <span className="text-[9px] font-black text-white/40 uppercase tracking-[0.2em] mt-1">Social Universe</span>
        </div>
        <div className="flex items-center gap-3 glass px-4 py-2 rounded-2xl border border-yellow-500/20">
           <span className="text-yellow-500 animate-pulse">🪙</span>
           <span className="text-sm font-black text-yellow-500">{userData?.coins || 0}</span>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto pb-44 hide-scrollbar px-6">
        {currentTab === 'home' && <HomeScreen songs={songs} onPlay={handlePlay} currentSong={currentSong} isPlaying={isPlaying} userData={userData} />}
        {currentTab === 'search' && <SearchScreen songs={songs} onPlay={handlePlay} currentSong={currentSong} isPlaying={isPlaying} />}
        {currentTab === 'library' && <LibraryScreen songs={songs} onPlay={handlePlay} userData={userData} />}
        {currentTab === 'profile' && (
          <ProfileScreen 
            userData={userData} 
            songs={songs} 
            onPlay={handlePlay} 
            onToast={setToastMsg}
            onUpgrade={() => processTransaction(100, "Premium Upgrade", "spend").then(res => {
              if (res) updateDoc(doc(db, 'users', userData!.uid), { isPremium: true });
            })}
          />
        )}
      </main>

      {/* Mini Player */}
      {currentSong && !isPlayerOpen && (
        <div 
          onClick={() => setIsPlayerOpen(true)}
          className="fixed bottom-[90px] left-4 right-4 h-16 glass rounded-2xl flex items-center px-3 gap-3 shadow-2xl z-40 cursor-pointer animate-slide-up border border-white/10"
        >
          <img src={currentSong.img} alt="" className="w-10 h-10 rounded-xl object-cover shadow-lg" />
          <div className="flex-1 overflow-hidden">
            <div className="text-sm font-bold truncate">{currentSong.title}</div>
            <div className="text-[10px] text-white/50 uppercase font-black truncate">{currentSong.artist}</div>
          </div>
          <button 
            onClick={(e) => { e.stopPropagation(); handlePlay(currentSong); }}
            className="w-10 h-10 flex items-center justify-center bg-white text-black rounded-full"
          >
            {isPlaying ? <PauseIcon size={18} /> : <PlayIcon size={18} fill="black" />}
          </button>
        </div>
      )}

      {/* Full Player Overlay */}
      {isPlayerOpen && currentSong && (
        <div className="fixed inset-0 player-gradient z-[100] p-8 flex flex-col animate-slide-up overflow-y-auto hide-scrollbar">
          <div className="flex justify-between items-center mb-8">
            <button onClick={() => setIsPlayerOpen(false)} className="w-10 h-10 flex items-center justify-center glass rounded-full">
               <svg className="w-5 h-5 rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"/></svg>
            </button>
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-white/40">Broadcasting</span>
            <button className="w-10 h-10 flex items-center justify-center glass rounded-full">
              <span className="text-xl">⋮</span>
            </button>
          </div>

          <div className="flex-1 flex flex-col items-center">
             <div className="relative mb-10">
                <img src={currentSong.img} alt="" className="w-[85vw] aspect-square rounded-[2.5rem] object-cover shadow-[0_40px_80px_-20px_rgba(168,85,247,0.4)]" />
                {isPlaying && (
                  <div className="absolute -inset-3 border-2 border-purple-500/20 rounded-[2.8rem] animate-ping opacity-20"></div>
                )}
             </div>
             
             <div className="w-full flex justify-between items-center mb-6">
                <div className="flex-1 min-w-0 pr-4">
                  <h2 className="text-3xl font-black leading-tight truncate">{currentSong.title}</h2>
                  <p className="text-lg text-purple-400 font-bold uppercase tracking-wide truncate">{currentSong.artist}</p>
                </div>
                <button 
                  onClick={() => handleLike(currentSong.id)}
                  className={`w-12 h-12 flex items-center justify-center glass rounded-2xl transition-all ${userData?.likedSongs?.includes(currentSong.id) ? 'text-red-500 scale-110' : 'text-white/40'}`}
                >
                  <svg className="w-6 h-6" fill={userData?.likedSongs?.includes(currentSong.id) ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/></svg>
                </button>
             </div>

             {/* Progress Bar */}
             <div className="w-full mb-8">
               <div className="h-1 w-full bg-white/10 rounded-full overflow-hidden relative">
                 <div className="h-full bg-purple-500" style={{ width: `${(audioProgress/audioDuration)*100}%` }}></div>
               </div>
               <div className="flex justify-between mt-2 text-[10px] font-black text-white/30 uppercase tracking-widest">
                 <span>{formatTime(audioProgress)}</span>
                 <span>{formatTime(audioDuration)}</span>
               </div>
             </div>

             {/* AI Trivia */}
             <div className="w-full glass rounded-3xl p-5 border border-purple-500/10 mb-8">
                <div className="flex items-center gap-2 mb-2">
                   <div className="w-1.5 h-1.5 bg-purple-500 rounded-full animate-pulse"></div>
                   <span className="text-[10px] font-black uppercase tracking-widest text-purple-400">GenAI Insight</span>
                </div>
                {isTriviaLoading ? (
                  <div className="animate-pulse space-y-2">
                    <div className="h-2 bg-white/5 rounded-full w-full"></div>
                    <div className="h-2 bg-white/5 rounded-full w-2/3"></div>
                  </div>
                ) : (
                  <p className="text-xs text-white/70 leading-relaxed font-medium italic">"{songTrivia}"</p>
                )}
             </div>

             <div className="w-full flex justify-between items-center px-4">
                <button onClick={() => handleDownload(currentSong)} className="w-12 h-12 flex items-center justify-center glass rounded-2xl text-white/40">
                  <DownloadIcon size={22} />
                </button>
                <div className="flex items-center gap-6">
                  <button className="text-white/20"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m15 18-6-6 6-6"/></svg></button>
                  <button 
                    onClick={() => handlePlay(currentSong)}
                    className="w-20 h-20 flex items-center justify-center bg-white text-black rounded-full shadow-2xl active:scale-90 transition-transform"
                  >
                    {isPlaying ? <PauseIcon size={32} /> : <PlayIcon size={32} fill="black" />}
                  </button>
                  <button className="text-white/20"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m9 18 6-6-6-6"/></svg></button>
                </div>
                <button 
                  onClick={() => setIsDedicateModalOpen(true)}
                  className="w-12 h-12 flex items-center justify-center bg-purple-600 rounded-2xl text-white shadow-lg shadow-purple-900/30"
                >
                  <GiftIcon size={22} />
                </button>
             </div>
          </div>
        </div>
      )}

      {/* Dedication Modal */}
      {isDedicateModalOpen && currentSong && (
        <DedicateModal 
          song={currentSong} 
          userData={userData} 
          onClose={() => setIsDedicateModalOpen(false)}
          onSend={async (targetUid, msg) => {
            const success = await processTransaction(5, `Dedication: ${currentSong.title}`, 'spend');
            if (success) {
              await addDoc(collection(db, 'dedications'), {
                fromUid: userData!.uid,
                fromName: userData!.name,
                toUid: targetUid,
                songId: currentSong.id,
                songTitle: currentSong.title,
                message: msg,
                timestamp: Date.now()
              });
              setToastMsg("Dedication sent! 🚀");
              setIsDedicateModalOpen(false);
            }
          }}
        />
      )}

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 h-[84px] bg-[#0a0a0a]/80 backdrop-blur-2xl border-t border-white/5 flex items-center justify-around z-[50] px-4 pb-safe">
        <button onClick={() => setCurrentTab('home')} className={`flex flex-col items-center gap-1 transition-all ${currentTab === 'home' ? 'text-purple-500 scale-110' : 'text-white/30'}`}>
          <HomeIcon /> <span className="text-[9px] font-black uppercase">Home</span>
        </button>
        <button onClick={() => setCurrentTab('search')} className={`flex flex-col items-center gap-1 transition-all ${currentTab === 'search' ? 'text-purple-500 scale-110' : 'text-white/30'}`}>
          <SearchIcon /> <span className="text-[9px] font-black uppercase">Search</span>
        </button>
        <button onClick={() => setCurrentTab('library')} className={`flex flex-col items-center gap-1 transition-all ${currentTab === 'library' ? 'text-purple-500 scale-110' : 'text-white/30'}`}>
          <LibraryIcon /> <span className="text-[9px] font-black uppercase">Lib</span>
        </button>
        <button onClick={() => setCurrentTab('profile')} className={`flex flex-col items-center gap-1 transition-all ${currentTab === 'profile' ? 'text-purple-500 scale-110' : 'text-white/30'}`}>
          <ProfileIcon /> <span className="text-[9px] font-black uppercase">You</span>
        </button>
      </nav>

      {toastMsg && <Toast message={toastMsg} onClose={() => setToastMsg('')} />}
    </div>
  );
}

// --- SUB COMPONENTS ---

function DedicateModal({ song, userData, onClose, onSend }: { song: Song; userData: UserData | null; onClose: () => void; onSend: (uid: string, msg: string) => void }) {
  const [friends, setFriends] = useState<any[]>([]);
  const [selectedFriend, setSelectedFriend] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!userData?.friends) return;
    // Simple fetch for demo
    const fetchFriends = async () => {
       const users = [];
       for (const fid of userData.friends) {
         const d = await getDoc(doc(db, 'users', fid));
         if (d.exists()) users.push(d.data());
       }
       setFriends(users);
    }
    fetchFriends();
  }, [userData]);

  return (
    <div className="fixed inset-0 z-[110] bg-black/90 backdrop-blur-sm flex items-end p-4 animate-slide-up">
      <div className="w-full glass rounded-[2.5rem] p-8 border border-white/10">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-black italic">Dedicate Track</h3>
          <button onClick={onClose} className="text-white/40">Close</button>
        </div>
        <p className="text-xs text-white/40 uppercase font-black mb-4">Choose a Friend (Cost: 5 🪙)</p>
        <div className="flex gap-4 overflow-x-auto hide-scrollbar mb-6">
          {friends.map(f => (
            <button 
              key={f.uid} 
              onClick={() => setSelectedFriend(f.uid)}
              className={`flex-shrink-0 w-16 h-16 rounded-full border-2 transition-all p-1 ${selectedFriend === f.uid ? 'border-purple-500 scale-110' : 'border-transparent'}`}
            >
              <img src={f.img || `https://ui-avatars.com/api/?name=${f.name}`} className="w-full h-full rounded-full object-cover" />
            </button>
          ))}
          {friends.length === 0 && <p className="text-xs text-white/20">No friends connected</p>}
        </div>
        <textarea 
          placeholder="Add a sweet message..." 
          className="w-full bg-white/5 rounded-2xl p-4 text-sm outline-none border border-white/5 focus:border-purple-500 mb-6 h-24"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        ></textarea>
        <button 
          disabled={!selectedFriend}
          onClick={() => onSend(selectedFriend, message)}
          className="w-full py-4 bg-purple-600 rounded-2xl font-black tracking-widest uppercase shadow-xl shadow-purple-900/30 disabled:opacity-20"
        >
          Send Dedication
        </button>
      </div>
    </div>
  );
}

function AuthScreen({ onToast }: { onToast: (m: string) => void }) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(cred.user, { displayName: name });
        await setDoc(doc(db, 'users', cred.user.uid), {
          uid: cred.user.uid,
          name,
          email,
          isPrivate: false,
          coins: 20, // Welcome gift
          isPremium: false,
          friends: [],
          likedSongs: [],
          coinHistory: [{ id: 'welcome', type: 'earn', amount: 20, description: 'Welcome Gift', timestamp: Date.now() }]
        });
        onToast("Welcome to the Universe! 🎁");
      }
    } catch (err: any) { alert(err.message); } finally { setLoading(false); }
  };

  return (
    <div className="h-screen bg-[#0a0a0a] p-10 flex flex-col justify-center">
      <div className="mb-12 text-center">
        <h1 className="text-6xl font-black text-purple-500 tracking-tighter mb-2 italic">MUSICO</h1>
        <p className="text-white/40 font-bold uppercase tracking-widest text-[10px]">Enter the Sonic Universe</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4 max-w-sm w-full mx-auto">
        {!isLogin && (
          <input type="text" placeholder="Identity Name" required className="w-full p-5 bg-white/5 border border-white/10 rounded-2xl outline-none focus:border-purple-500 text-white font-bold" value={name} onChange={(e) => setName(e.target.value)} />
        )}
        <input type="email" placeholder="Email Address" required className="w-full p-5 bg-white/5 border border-white/10 rounded-2xl outline-none focus:border-purple-500 text-white font-bold" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input type="password" placeholder="Key Phrase" required className="w-full p-5 bg-white/5 border border-white/10 rounded-2xl outline-none focus:border-purple-500 text-white font-bold" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button disabled={loading} className="w-full py-5 bg-purple-600 rounded-2xl font-black text-lg hover:bg-purple-700 active:scale-95 transition-all shadow-2xl shadow-purple-900/40 disabled:opacity-50 mt-4 text-white uppercase tracking-widest">
          {loading ? 'Transmitting...' : (isLogin ? 'Initiate Session' : 'Create Identity')}
        </button>
      </form>
      <p className="mt-10 text-center text-white/30 font-bold text-sm">
        {isLogin ? "NEW VOYAGER?" : "RETURNING VOYAGER?"}{' '}
        <span onClick={() => setIsLogin(!isLogin)} className="text-purple-500 cursor-pointer uppercase tracking-tighter">
          {isLogin ? 'Join Orbit' : 'Login'}
        </span>
      </p>
    </div>
  );
}

function HomeScreen({ songs, onPlay, currentSong, isPlaying, userData }: { songs: Song[]; onPlay: (s: Song) => void; currentSong: Song | null; isPlaying: boolean; userData: UserData | null }) {
  return (
    <div className="space-y-10 py-4 animate-slide-up">
      <section>
        <div className="h-60 rounded-[2.5rem] overflow-hidden relative shadow-2xl group">
          <img src="https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?q=80&w=1000&auto=format&fit=crop" alt="Banner" className="w-full h-full object-cover brightness-75 group-hover:scale-105 transition-transform duration-1000" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0a] via-[#0a0a0a]/20 to-transparent flex flex-col justify-end p-8">
            <span className="bg-purple-600 text-[10px] font-black px-4 py-1.5 rounded-full w-fit mb-3 tracking-widest uppercase shadow-lg">Trending Universe</span>
            <h3 className="text-4xl font-black italic leading-none">Sonic Nebula</h3>
            <p className="text-white/50 text-xs mt-3 font-bold uppercase tracking-widest">Curated for {userData?.name}</p>
          </div>
        </div>
      </section>

      {!userData?.isPremium && (
        <div className="p-6 bg-gradient-to-r from-yellow-500/10 to-purple-600/10 rounded-[2rem] border border-yellow-500/20 flex items-center justify-between">
          <div>
            <h4 className="text-lg font-black text-yellow-500 italic">Go Premium</h4>
            <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Ad-free & Uncapped Storage</p>
          </div>
          <span className="text-2xl">✨</span>
        </div>
      )}

      <section>
        <div className="flex justify-between items-end mb-6">
          <h2 className="text-2xl font-black italic tracking-tighter">Rising Stars</h2>
          <button className="text-[10px] font-black text-purple-500 tracking-widest uppercase">Explore All</button>
        </div>
        <div className="flex gap-6 overflow-x-auto hide-scrollbar -mx-2 px-2">
          {songs.map((song) => (
            <div key={song.id} onClick={() => onPlay(song)} className="flex-shrink-0 w-44 space-y-3 group cursor-pointer">
              <div className="relative aspect-square rounded-[2rem] overflow-hidden shadow-xl border border-white/5">
                <img src={song.img} alt={song.title} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" />
                {currentSong?.id === song.id && isPlaying && (
                   <div className="absolute inset-0 bg-purple-600/40 backdrop-blur-sm flex items-center justify-center">
                      <div className="flex gap-1.5 items-end h-8">
                        <div className="w-1.5 bg-white rounded-full animate-bounce h-4"></div>
                        <div className="w-1.5 bg-white rounded-full animate-bounce h-6 [animation-delay:0.2s]"></div>
                        <div className="w-1.5 bg-white rounded-full animate-bounce h-3 [animation-delay:0.4s]"></div>
                      </div>
                   </div>
                )}
              </div>
              <div className="px-1">
                <p className="text-sm font-black truncate">{song.title}</p>
                <p className="text-[10px] text-white/30 uppercase font-black truncate tracking-tighter">{song.artist}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-white/5 rounded-[2.5rem] p-6 border border-white/5">
        <h2 className="text-xl font-black italic tracking-tighter mb-6">Social Feed</h2>
        <div className="flex items-center gap-4 p-4 glass rounded-3xl border border-purple-500/10">
           <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-purple-500 to-pink-500 p-0.5">
              <div className="w-full h-full bg-[#0a0a0a] rounded-full flex items-center justify-center font-black text-xs">AI</div>
           </div>
           <p className="text-xs text-white/50 leading-relaxed font-bold">New tracks arrived in your sector! Spend 🪙 coins to dedicate them to friends.</p>
        </div>
      </section>
    </div>
  );
}

function SearchScreen({ songs, onPlay, currentSong, isPlaying }: { songs: Song[]; onPlay: (s: Song) => void; currentSong: Song | null; isPlaying: boolean }) {
  const [queryText, setQueryText] = useState('');
  const filtered = useMemo(() => 
    songs.filter(s => s.title.toLowerCase().includes(queryText.toLowerCase()) || s.artist.toLowerCase().includes(queryText.toLowerCase())), 
    [queryText, songs]
  );

  return (
    <div className="py-4 space-y-8 animate-slide-up">
      <div className="relative group">
        <div className="absolute left-6 top-1/2 -translate-y-1/2 text-white/20 group-focus-within:text-purple-500 transition-colors">
          <SearchIcon size={22} />
        </div>
        <input 
          type="text" 
          placeholder="Search Universe..."
          className="w-full py-5 pl-16 pr-6 bg-white/5 border border-white/10 rounded-3xl outline-none focus:border-purple-500 focus:bg-white/10 transition-all font-bold text-white placeholder:text-white/20"
          value={queryText}
          onChange={(e) => setQueryText(e.target.value)}
        />
      </div>

      <div className="space-y-4">
        {filtered.map(song => (
          <div key={song.id} onClick={() => onPlay(song)} className="flex items-center gap-5 p-4 glass rounded-3xl active:scale-95 transition-all border border-transparent hover:border-white/10">
            <img src={song.img} alt="" className="w-16 h-16 rounded-2xl object-cover shadow-xl" />
            <div className="flex-1">
               <p className="font-black text-base truncate">{song.title}</p>
               <p className="text-[10px] text-purple-400 uppercase font-black truncate tracking-widest">{song.artist}</p>
            </div>
            <div className={`w-12 h-12 flex items-center justify-center rounded-full transition-all ${currentSong?.id === song.id && isPlaying ? 'bg-purple-600' : 'glass'}`}>
               {currentSong?.id === song.id && isPlaying ? <PauseIcon size={20} /> : <PlayIcon size={20} fill="currentColor" />}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LibraryScreen({ songs, onPlay, userData }: { songs: Song[]; onPlay: (s: Song) => void; userData: UserData | null }) {
  const [offlineSongs, setOfflineSongs] = useState<any[]>([]);

  useEffect(() => { getAllOfflineSongs().then(setOfflineSongs); }, []);

  const likedSongsList = useMemo(() => 
    songs.filter(s => userData?.likedSongs?.includes(s.id)), 
    [songs, userData?.likedSongs]
  );

  return (
    <div className="py-4 space-y-10 animate-slide-up">
      <h2 className="text-4xl font-black italic tracking-tighter">My Orbit</h2>
      
      <div className="grid grid-cols-2 gap-5">
        <div className="bg-gradient-to-br from-red-500 to-pink-700 aspect-square rounded-[2.5rem] p-7 flex flex-col justify-end shadow-xl shadow-red-900/20 active:scale-95 transition-transform">
           <span className="text-3xl mb-3">❤️</span>
           <p className="font-black text-2xl leading-none">Likes</p>
           <p className="text-[10px] font-black uppercase opacity-60 mt-1">{likedSongsList.length} Tracks</p>
        </div>
        <div className="bg-gradient-to-br from-purple-600 to-indigo-700 aspect-square rounded-[2.5rem] p-7 flex flex-col justify-end shadow-xl shadow-purple-900/20 active:scale-95 transition-transform">
           <span className="text-3xl mb-3">📦</span>
           <p className="font-black text-2xl leading-none">Offline</p>
           <p className="text-[10px] font-black uppercase opacity-60 mt-1">{offlineSongs.length} Cached</p>
        </div>
      </div>

      <section>
        <h3 className="text-[10px] font-black text-white/40 uppercase tracking-[0.3em] mb-6">Stored in Device</h3>
        <div className="space-y-3">
           {offlineSongs.map(s => (
             <div key={s.id} onClick={() => onPlay(s)} className="flex items-center gap-4 p-4 glass rounded-3xl active:bg-white/5 border border-white/5">
                <img src={s.img} alt="" className="w-14 h-14 rounded-2xl object-cover" />
                <div className="flex-1">
                  <p className="font-black text-sm truncate">{s.title}</p>
                  <p className="text-[10px] text-white/30 uppercase font-black truncate">{s.artist}</p>
                </div>
                <div className="text-green-500 bg-green-500/10 p-2 rounded-full">
                   <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
                </div>
             </div>
           ))}
           {offlineSongs.length === 0 && (
             <div className="p-12 text-center glass rounded-[2.5rem] border-dashed border-white/10">
               <p className="text-white/20 italic font-medium">No offline tracks detected.</p>
             </div>
           )}
        </div>
      </section>
    </div>
  );
}

function ProfileScreen({ userData, songs, onPlay, onToast, onUpgrade }: { userData: UserData | null; songs: Song[]; onPlay: (s: Song) => void; onToast: (m: string) => void; onUpgrade: () => void }) {
  const [activeTab, setActiveTab] = useState<'social' | 'gifts' | 'history'>('social');
  const [showSettings, setShowSettings] = useState(false);
  const [friendSearch, setFriendSearch] = useState('');
  const [foundUsers, setFoundUsers] = useState<any[]>([]);
  const [dedications, setDedications] = useState<Dedication[]>([]);

  useEffect(() => {
    if (!userData?.uid) return;
    const q = query(collection(db, 'dedications'), where('toUid', '==', userData.uid));
    const unsubscribe = onSnapshot(q, (snap) => {
      setDedications(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Dedication)));
    });
    return unsubscribe;
  }, [userData?.uid]);

  const searchFriends = async () => {
    if (friendSearch.length < 2) return;
    const q = query(collection(db, 'users'), where('name', '>=', friendSearch), where('name', '<=', friendSearch + '\uf8ff'));
    const snap = await getDocs(q);
    setFoundUsers(snap.docs.map(d => d.data()).filter(u => u.uid !== userData?.uid));
  };

  return (
    <div className="py-4 animate-slide-up">
      <div className="flex items-center justify-between mb-10">
        <h2 className="text-4xl font-black italic tracking-tighter">Identity</h2>
        <button onClick={() => setShowSettings(!showSettings)} className="w-12 h-12 flex items-center justify-center glass rounded-2xl active:rotate-90 transition-all text-white">
           <SettingsIcon size={24} />
        </button>
      </div>

      {showSettings && (
        <div className="mb-10 p-8 glass rounded-[2.5rem] border border-white/10 space-y-6 animate-slide-up shadow-2xl">
           <div className="flex items-center justify-between">
              <div>
                <p className="font-black text-sm text-white uppercase">Ghost Protocol</p>
                <p className="text-[10px] text-white/40 font-bold uppercase">Visibility off</p>
              </div>
              <button onClick={() => updateDoc(doc(db, 'users', userData!.uid), { isPrivate: !userData?.isPrivate })} className={`w-14 h-7 rounded-full transition-all relative ${userData?.isPrivate ? 'bg-purple-600' : 'bg-white/10'}`}>
                <div className={`absolute top-1 w-5 h-5 bg-white rounded-full transition-all ${userData?.isPrivate ? 'right-1' : 'left-1'}`}></div>
              </button>
           </div>
           {!userData?.isPremium && (
             <button onClick={onUpgrade} className="w-full py-4 bg-yellow-600/20 text-yellow-500 rounded-2xl font-black text-xs tracking-widest uppercase border border-yellow-500/30">
               Buy Premium (100 🪙)
             </button>
           )}
           <button onClick={() => signOut(auth)} className="w-full py-4 bg-red-600/10 text-red-500 rounded-2xl font-black text-xs tracking-widest uppercase border border-red-500/20">Sign Out</button>
        </div>
      )}

      <div className="flex flex-col items-center mb-10">
         <div className="relative">
            <div className="absolute inset-0 bg-purple-500 rounded-full blur-3xl opacity-20"></div>
            <img 
              src={userData?.img || `https://ui-avatars.com/api/?name=${userData?.name || 'User'}&background=6366f1&color=fff&size=256`} 
              className="w-36 h-36 rounded-full border-[6px] border-[#0a0a0a] ring-2 ring-white/10 shadow-2xl object-cover relative z-10" 
              alt="" 
            />
            {userData?.isPremium && <div className="absolute bottom-1 right-1 bg-yellow-500 text-black p-2 rounded-full z-20 border-4 border-[#0a0a0a] shadow-lg animate-bounce"><span className="text-xs">✨</span></div>}
         </div>
         <h3 className="text-3xl font-black mt-6 tracking-tight text-white">{userData?.name || 'Voyager'}</h3>
         <p className="text-purple-400 font-black uppercase tracking-[0.25em] text-[10px] mt-1">{userData?.isPremium ? 'Premium Voyager' : 'Basic Protocol'}</p>
         
         <div className="grid grid-cols-3 w-full max-w-sm mt-10 p-6 glass rounded-[2.5rem] border border-white/5">
            <div className="text-center border-r border-white/5">
               <p className="font-black text-xl leading-none">{userData?.friends?.length || 0}</p>
               <p className="text-[9px] text-white/40 font-black uppercase tracking-widest mt-2">Allies</p>
            </div>
            <div className="text-center border-r border-white/5">
               <p className="font-black text-xl leading-none">{userData?.likedSongs?.length || 0}</p>
               <p className="text-[9px] text-white/40 font-black uppercase tracking-widest mt-2">Hearts</p>
            </div>
            <div className="text-center">
               <p className="font-black text-xl leading-none">{dedications.length}</p>
               <p className="text-[9px] text-white/40 font-black uppercase tracking-widest mt-2">Gifts</p>
            </div>
         </div>
      </div>

      <div className="flex glass rounded-2xl p-1.5 mb-8">
        <button onClick={() => setActiveTab('social')} className={`flex-1 py-3 text-[10px] font-black tracking-[0.2em] uppercase rounded-xl transition-all ${activeTab === 'social' ? 'bg-white text-black shadow-lg' : 'text-white/40'}`}>Allies</button>
        <button onClick={() => setActiveTab('gifts')} className={`flex-1 py-3 text-[10px] font-black tracking-[0.2em] uppercase rounded-xl transition-all ${activeTab === 'gifts' ? 'bg-white text-black shadow-lg' : 'text-white/40'}`}>Gifts</button>
        <button onClick={() => setActiveTab('history')} className={`flex-1 py-3 text-[10px] font-black tracking-[0.2em] uppercase rounded-xl transition-all ${activeTab === 'history' ? 'bg-white text-black shadow-lg' : 'text-white/40'}`}>Ledger</button>
      </div>

      <div className="min-h-[400px]">
        {activeTab === 'social' && (
          <div className="space-y-8">
            <div className="flex gap-2">
               <input 
                 type="text" 
                 placeholder="Search Voyagers..." 
                 className="flex-1 glass rounded-2xl p-4 outline-none font-bold text-white placeholder:text-white/20"
                 value={friendSearch}
                 onChange={(e) => setFriendSearch(e.target.value)}
               />
               <button onClick={searchFriends} className="bg-purple-600 text-white font-black px-6 rounded-2xl">Find</button>
            </div>
            
            <div className="space-y-3">
               {foundUsers.map(u => (
                 <div key={u.uid} className="flex items-center justify-between p-4 glass rounded-3xl border border-white/5">
                    <div className="flex items-center gap-4">
                      <img src={u.img || `https://ui-avatars.com/api/?name=${u.name}`} className="w-12 h-12 rounded-2xl object-cover shadow-lg" />
                      <div>
                        <p className="font-black text-sm text-white uppercase">{u.name}</p>
                        <p className="text-[9px] font-black text-white/30 tracking-widest">{u.isPrivate ? 'GHOST' : 'VISIBLE'}</p>
                      </div>
                    </div>
                    <button onClick={async () => {
                      await updateDoc(doc(db, 'users', userData!.uid), { friends: arrayUnion(u.uid) });
                      await updateDoc(doc(db, 'users', u.uid), { friends: arrayUnion(userData!.uid) });
                      onToast("Ally Linked! 🔗");
                    }} className="bg-white text-black text-[10px] font-black uppercase px-4 py-2 rounded-xl active:scale-90 transition-transform">Link</button>
                 </div>
               ))}
            </div>
          </div>
        )}

        {activeTab === 'gifts' && (
          <div className="space-y-5">
             {dedications.map(d => (
               <div key={d.id} className="p-6 glass rounded-[2.5rem] relative overflow-hidden group border border-purple-500/10">
                  <div className="relative z-10">
                     <p className="text-[9px] font-black text-purple-400 uppercase tracking-[0.4em] mb-2">Signal from {d.fromName}</p>
                     <h5 className="text-2xl font-black leading-tight mb-1 text-white italic">{d.songTitle}</h5>
                     <p className="text-white/40 text-sm font-medium">"{d.message || "No message"}"</p>
                     <button onClick={() => { const s = songs.find(x => x.id === d.songId); if (s) onPlay(s); }} className="mt-6 flex items-center gap-2 text-[10px] font-black bg-white text-black px-6 py-3 rounded-2xl active:scale-95 transition-transform">
                        <PlayIcon size={14} fill="currentColor" /> Stream Now
                     </button>
                  </div>
               </div>
             ))}
             {dedications.length === 0 && <div className="py-20 text-center text-white/10 uppercase font-black text-sm tracking-widest">Inbox Secure & Empty</div>}
          </div>
        )}

        {activeTab === 'history' && (
           <div className="space-y-3">
              {userData?.coinHistory?.slice().reverse().map(tx => (
                <div key={tx.id} className="flex items-center justify-between p-4 glass rounded-3xl border border-white/5">
                   <div className="flex-1">
                      <p className="text-sm font-bold text-white">{tx.description}</p>
                      <p className="text-[10px] text-white/30 uppercase font-black">{new Date(tx.timestamp).toLocaleDateString()}</p>
                   </div>
                   <div className={`font-black text-sm ${tx.type === 'earn' ? 'text-green-500' : 'text-red-500'}`}>
                      {tx.type === 'earn' ? '+' : '-'}{tx.amount} 🪙
                   </div>
                </div>
              ))}
              {(!userData?.coinHistory || userData.coinHistory.length === 0) && <p className="text-center py-20 text-white/10 font-black uppercase">No Ledger Entries</p>}
           </div>
        )}
      </div>
    </div>
  );
}
