
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
  increment
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
// Fixed initialization to follow guidelines: using named parameter and process.env.API_KEY directly.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// --- UTILS ---
const formatTime = (seconds: number) => {
  if (isNaN(seconds)) return "0:00";
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
    <div className="fixed bottom-28 left-1/2 -translate-x-1/2 bg-purple-600 text-white px-6 py-3 rounded-2xl shadow-2xl z-[9999] text-sm font-bold animate-slide-up flex items-center gap-2 border border-white/20 whitespace-nowrap">
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

  // Load last played song
  useEffect(() => {
    const savedSong = localStorage.getItem('musico_last_song');
    if (savedSong) {
      try { 
        const parsed = JSON.parse(savedSong);
        setCurrentSong(parsed);
      } catch (e) { 
        console.error("Cache load fail"); 
      }
    }
  }, []);

  const updateMediaMetadata = useCallback((song: Song) => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: song.title,
        artist: song.artist,
        artwork: [{ src: song.img, sizes: '512x512', type: 'image/png' }]
      });
      navigator.mediaSession.setActionHandler('play', () => { 
        if (audioRef.current) {
          audioRef.current.play(); 
          setIsPlaying(true); 
        }
      });
      navigator.mediaSession.setActionHandler('pause', () => { 
        if (audioRef.current) {
          audioRef.current.pause(); 
          setIsPlaying(false); 
        }
      });
    }
  }, []);

  const fetchTrivia = useCallback(async (song: Song) => {
    if (!process.env.API_KEY || !isPlayerOpen) return;
    setIsTriviaLoading(true);
    try {
      // Use ai client instance and .text property as per guidelines.
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Fact check: "${song.title}" by "${song.artist}". Give one very short cool fact (10 words max). No markdown.`,
      });
      setSongTrivia(response.text || "Vibing in the cosmic soundscape...");
    } catch (error) {
      setSongTrivia("Discovering new dimensions of sound.");
    } finally {
      setIsTriviaLoading(false);
    }
  }, [isPlayerOpen]);

  useEffect(() => {
    if (currentSong && isPlayerOpen) fetchTrivia(currentSong);
  }, [currentSong, isPlayerOpen, fetchTrivia]);

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
        try {
          const querySnapshot = await getDocs(collection(db, 'songs'));
          setSongs(querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Song)));
        } catch (e) {
          console.error("Fetch songs error:", e);
        }
      };
      fetchSongs();
    }
  }, [user]);

  const handlePlay = (song: Song) => {
    if (!audioRef.current) return;

    if (currentSong?.id === song.id) {
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        audioRef.current.play().catch(e => {
          console.error("Playback failed:", e);
          setToastMsg("Playback error. Check connection.");
        });
        setIsPlaying(true);
      }
    } else {
      setCurrentSong(song);
      localStorage.setItem('musico_last_song', JSON.stringify(song));
      audioRef.current.src = song.url;
      audioRef.current.load();
      const playPromise = audioRef.current.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => setIsPlaying(true))
          .catch(e => {
            console.error("Playback failed:", e);
            setToastMsg("Stream unavailable.");
            setIsPlaying(false);
          });
      }
      updateMediaMetadata(song);
    }
  };

  const processTransaction = async (amount: number, description: string, type: 'earn' | 'spend') => {
    if (!userData) return false;
    if (type === 'spend' && userData.coins < amount) {
      setToastMsg("Need more coins! 🪙");
      return false;
    }
    const newTx: CoinTransaction = {
      id: Math.random().toString(36).substring(7),
      type,
      amount,
      description,
      timestamp: Date.now()
    };
    try {
      const userRef = doc(db, 'users', userData.uid);
      await updateDoc(userRef, {
        coins: increment(type === 'earn' ? amount : -amount),
        coinHistory: arrayUnion(newTx)
      });
      return true;
    } catch (e) {
      console.error("Tx failed:", e);
      return false;
    }
  };

  const handleLike = async (songId: string) => {
    if (!userData) return;
    const isLiked = userData.likedSongs?.includes(songId);
    try {
      await updateDoc(doc(db, 'users', userData.uid), {
        likedSongs: isLiked ? userData.likedSongs.filter(id => id !== songId) : arrayUnion(songId)
      });
      setToastMsg(isLiked ? "Removed from Likes" : "Added to Universe Favorites ❤️");
    } catch (e) {
      setToastMsg("Action failed.");
    }
  };

  const handleDownload = async (song: Song) => {
    if (!userData?.isPremium && userData?.coins! < 5) {
      setToastMsg("Need 5 coins for offline unlock 🪙");
      return;
    }
    
    setToastMsg(`Transmitting ${song.title} to local vault...`);
    try {
      const response = await fetch(song.url);
      if (!response.ok) throw new Error("Download error");
      const blob = await response.blob();
      await saveSongOffline(song.id, blob, { title: song.title, artist: song.artist, img: song.img, url: song.url });
      
      if (!userData?.isPremium) {
        await processTransaction(5, `Unlocked offline: ${song.title}`, 'spend');
      }
      setToastMsg('Securely stored offline! 🔒');
    } catch (error) {
      console.error(error);
      setToastMsg('Transmission interrupted.');
    }
  };

  if (loading) return (
    <div className="h-screen flex items-center justify-center bg-[#0a0a0a]">
      <div className="flex flex-col items-center gap-4">
        <div className="text-4xl font-black text-purple-500 animate-pulse tracking-tighter italic">MUSICO</div>
        <div className="w-16 h-1 bg-white/10 rounded-full overflow-hidden">
          <div className="h-full bg-purple-500 w-1/2 animate-loading-bar"></div>
        </div>
      </div>
      <style>{`
        @keyframes loadingBar { 
          0% { transform: translateX(-100%); } 
          100% { transform: translateX(200%); } 
        }
        .animate-loading-bar {
          animation: loadingBar 1.5s infinite linear;
        }
      `}</style>
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
        onError={() => {
          setIsPlaying(false);
          setToastMsg("Audio stream error.");
        }}
      />
      
      <header className="px-6 pt-10 pb-4 flex justify-between items-center bg-[#0a0a0a] z-10">
        <div className="flex flex-col">
          <span className="text-2xl font-black text-purple-500 tracking-tighter leading-none italic">MUSICO</span>
          <span className="text-[9px] font-black text-white/30 uppercase tracking-[0.2em] mt-1">Galaxy Stream</span>
        </div>
        <div className="flex items-center gap-3 glass px-4 py-2 rounded-2xl border border-yellow-500/10">
           <span className="text-yellow-500 animate-pulse text-lg">🪙</span>
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
            onUpgrade={() => processTransaction(100, "Elite Tier Upgrade", "spend").then(res => {
              if (res && userData) updateDoc(doc(db, 'users', userData.uid), { isPremium: true });
            })}
          />
        )}
      </main>

      {/* Mini Player */}
      {currentSong && !isPlayerOpen && (
        <div 
          onClick={() => setIsPlayerOpen(true)}
          className="fixed bottom-[90px] left-4 right-4 h-16 glass rounded-2xl flex items-center px-4 gap-4 shadow-2xl z-40 cursor-pointer animate-slide-up border border-white/5"
        >
          <img src={currentSong.img} alt="" className="w-10 h-10 rounded-xl object-cover" />
          <div className="flex-1 overflow-hidden">
            <div className="text-xs font-bold truncate">{currentSong.title}</div>
            <div className="text-[9px] text-white/40 uppercase font-black truncate">{currentSong.artist}</div>
          </div>
          <button 
            onClick={(e) => { e.stopPropagation(); handlePlay(currentSong); }}
            className="w-10 h-10 flex items-center justify-center bg-white text-black rounded-full shadow-lg"
          >
            {isPlaying ? <PauseIcon size={16} /> : <PlayIcon size={16} fill="black" />}
          </button>
        </div>
      )}

      {/* Full Player Overlay */}
      {isPlayerOpen && currentSong && (
        <div className="fixed inset-0 bg-[#0a0a0a] z-[100] flex flex-col animate-slide-up overflow-hidden">
          <div className="absolute inset-0 player-gradient opacity-60"></div>
          
          <div className="relative z-10 flex flex-col h-full p-8">
            <div className="flex justify-between items-center mb-8">
              <button onClick={() => setIsPlayerOpen(false)} className="w-10 h-10 flex items-center justify-center glass rounded-full">
                 <svg className="w-5 h-5 rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"/></svg>
              </button>
              <span className="text-[10px] font-black uppercase tracking-[0.3em] text-white/30">Syncing with Cosmos</span>
              <button className="w-10 h-10 flex items-center justify-center glass rounded-full">
                <span className="text-xl">⋮</span>
              </button>
            </div>

            <div className="flex-1 flex flex-col items-center justify-center">
              <div className="relative mb-12">
                  <img src={currentSong.img} alt="" className="w-[82vw] aspect-square rounded-[3rem] object-cover shadow-[0_50px_100px_-20px_rgba(168,85,247,0.4)] border border-white/10" />
                  {isPlaying && (
                    <div className="absolute -inset-4 border-2 border-purple-500/20 rounded-[3.2rem] animate-ping opacity-10"></div>
                  )}
              </div>
              
              <div className="w-full flex justify-between items-center mb-8 px-2">
                  <div className="flex-1 min-w-0 pr-6">
                    <h2 className="text-3xl font-black leading-tight truncate">{currentSong.title}</h2>
                    <p className="text-lg text-purple-400 font-bold uppercase tracking-wider truncate opacity-80">{currentSong.artist}</p>
                  </div>
                  <button 
                    onClick={() => handleLike(currentSong.id)}
                    className={`w-14 h-14 flex items-center justify-center glass rounded-[1.5rem] transition-all ${userData?.likedSongs?.includes(currentSong.id) ? 'text-red-500 bg-red-500/10' : 'text-white/20'}`}
                  >
                    <svg className="w-7 h-7" fill={userData?.likedSongs?.includes(currentSong.id) ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/></svg>
                  </button>
              </div>

              {/* Progress Bar */}
              <div className="w-full mb-10 px-2">
                <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden relative border border-white/5">
                  <div className="h-full bg-gradient-to-r from-purple-500 to-indigo-500 shadow-[0_0_10px_rgba(168,85,247,0.5)] transition-all duration-300" style={{ width: `${(audioProgress/audioDuration)*100}%` }}></div>
                </div>
                <div className="flex justify-between mt-3 text-[10px] font-black text-white/20 uppercase tracking-[0.2em]">
                  <span>{formatTime(audioProgress)}</span>
                  <span>{formatTime(audioDuration)}</span>
                </div>
              </div>

              {/* AI Trivia */}
              <div className="w-full glass rounded-[2rem] p-6 border border-white/5 mb-10 min-h-[80px]">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse"></div>
                    <span className="text-[10px] font-black uppercase tracking-singular [0.2em] text-purple-400">AI Chronicle</span>
                  </div>
                  {isTriviaLoading ? (
                    <div className="space-y-2 animate-pulse">
                      <div className="h-2 bg-white/10 rounded-full w-full"></div>
                      <div className="h-2 bg-white/10 rounded-full w-2/3"></div>
                    </div>
                  ) : (
                    <p className="text-sm text-white/60 leading-relaxed font-semibold italic">"{songTrivia}"</p>
                  )}
              </div>

              <div className="w-full flex justify-between items-center px-4 mb-4">
                  <button onClick={() => handleDownload(currentSong)} className="w-14 h-14 flex items-center justify-center glass rounded-2xl text-white/30 hover:text-white transition-colors">
                    <DownloadIcon size={24} />
                  </button>
                  <div className="flex items-center gap-8">
                    <button className="text-white/20 hover:text-white" onClick={() => setToastMsg("Previous feature coming soon...")}>
                      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m15 18-6-6 6-6"/></svg>
                    </button>
                    <button 
                      onClick={() => handlePlay(currentSong)}
                      className="w-24 h-24 flex items-center justify-center bg-white text-black rounded-full shadow-2xl active:scale-90 transition-transform"
                    >
                      {isPlaying ? <PauseIcon size={36} /> : <PlayIcon size={36} fill="black" />}
                    </button>
                    <button className="text-white/20 hover:text-white" onClick={() => setToastMsg("Next feature coming soon...")}>
                      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m9 18 6-6-6-6"/></svg>
                    </button>
                  </div>
                  <button 
                    onClick={() => setIsDedicateModalOpen(true)}
                    className="w-14 h-14 flex items-center justify-center bg-purple-600 rounded-2xl text-white shadow-xl shadow-purple-900/40 hover:bg-purple-500"
                  >
                    <GiftIcon size={24} />
                  </button>
              </div>
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
            const success = await processTransaction(5, `Gifting: ${currentSong.title}`, 'spend');
            if (success && userData) {
              await addDoc(collection(db, 'dedications'), {
                fromUid: userData.uid,
                fromName: userData.name,
                toUid: targetUid,
                songId: currentSong.id,
                songTitle: currentSong.title,
                message: msg,
                timestamp: Date.now()
              });
              setToastMsg("Sonic gift sent! 🚀");
              setIsDedicateModalOpen(false);
            }
          }}
        />
      )}

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 h-[94px] bg-[#0a0a0a]/90 backdrop-blur-3xl border-t border-white/5 flex items-center justify-around z-[50] px-6 pb-safe">
        <button onClick={() => setCurrentTab('home')} className={`flex-col items-center gap-2 transition-all ${currentTab === 'home' ? 'text-purple-500 scale-110' : 'text-white/20'}`}>
          <HomeIcon size={24} /> <span className="text-[9px] font-black uppercase tracking-widest">Orbit</span>
        </button>
        <button onClick={() => setCurrentTab('search')} className={`flex-col items-center gap-2 transition-all ${currentTab === 'search' ? 'text-purple-500 scale-110' : 'text-white/20'}`}>
          <SearchIcon size={24} /> <span className="text-[9px] font-black uppercase tracking-widest">Echo</span>
        </button>
        <button onClick={() => setCurrentTab('library')} className={`flex-col items-center gap-2 transition-all ${currentTab === 'library' ? 'text-purple-500 scale-110' : 'text-white/20'}`}>
          <LibraryIcon size={24} /> <span className="text-[9px] font-black uppercase tracking-widest">Vault</span>
        </button>
        <button onClick={() => setCurrentTab('profile')} className={`flex-col items-center gap-2 transition-all ${currentTab === 'profile' ? 'text-purple-500 scale-110' : 'text-white/20'}`}>
          <ProfileIcon size={24} /> <span className="text-[9px] font-black uppercase tracking-widest">Me</span>
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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userData?.friends) return;
    const fetchFriends = async () => {
       const users = [];
       for (const fid of userData.friends) {
         try {
           const d = await getDoc(doc(db, 'users', fid));
           if (d.exists()) users.push(d.data());
         } catch(e) {}
       }
       setFriends(users);
       setLoading(false);
    };
    fetchFriends();
  }, [userData]);

  return (
    <div className="fixed inset-0 z-[110] bg-black/80 backdrop-blur-md flex items-end p-4 animate-slide-up">
      <div className="w-full glass rounded-[3rem] p-10 border border-white/10 shadow-[0_-20px_50px_rgba(168,85,247,0.2)]">
        <div className="flex justify-between items-center mb-8">
          <h3 className="text-2xl font-black italic">Dedicate Sound</h3>
          <button onClick={onClose} className="w-10 h-10 flex items-center justify-center bg-white/5 rounded-full text-white/40">✕</button>
        </div>
        
        <p className="text-[10px] text-white/30 uppercase font-black mb-6 tracking-widest">Select Target Ally (Cost: 5 🪙)</p>
        <div className="flex gap-5 overflow-x-auto hide-scrollbar mb-8 py-2">
          {friends.map(f => (
            <button 
              key={f.uid} 
              onClick={() => setSelectedFriend(f.uid)}
              className={`flex-shrink-0 flex flex-col items-center gap-3 transition-all ${selectedFriend === f.uid ? 'scale-110 opacity-100' : 'opacity-40'}`}
            >
              <div className={`w-16 h-16 rounded-full p-1 border-2 ${selectedFriend === f.uid ? 'border-purple-500' : 'border-transparent'}`}>
                <img src={f.img || `https://ui-avatars.com/api/?name=${f.name}&background=6366f1&color=fff`} className="w-full h-full rounded-full object-cover" />
              </div>
              <span className="text-[9px] font-black truncate max-w-[64px] uppercase">{f.name.split(' ')[0]}</span>
            </button>
          ))}
          {friends.length === 0 && !loading && <p className="text-xs text-white/20 italic p-4">Your cosmic network is empty.</p>}
        </div>

        <div className="space-y-6">
          <textarea 
            placeholder="Transmit a personalized signal..." 
            className="w-full bg-white/5 rounded-3xl p-6 text-sm font-medium outline-none border border-white/10 focus:border-purple-500 h-28 resize-none placeholder:text-white/10"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          ></textarea>
          <button 
            disabled={!selectedFriend}
            onClick={() => onSend(selectedFriend, message)}
            className="w-full py-5 bg-purple-600 text-white rounded-[1.8rem] font-black tracking-[0.2em] uppercase shadow-2xl shadow-purple-900/40 disabled:opacity-20 active:scale-95 transition-all"
          >
            Initiate Dedication
          </button>
        </div>
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
        const newUser: UserData = {
          uid: cred.user.uid,
          name,
          email,
          isPrivate: false,
          coins: 20,
          isPremium: false,
          friends: [],
          likedSongs: [],
          coinHistory: [{ id: 'genesis', type: 'earn', amount: 20, description: 'Genesis Reward', timestamp: Date.now() }]
        };
        await setDoc(doc(db, 'users', cred.user.uid), newUser);
        onToast("Galaxy account established! 🌌");
      }
    } catch (err: any) { 
      alert(err.message); 
    } finally { 
      setLoading(false); 
    }
  };

  return (
    <div className="h-screen bg-[#0a0a0a] p-10 flex flex-col justify-center animate-slide-up">
      <div className="mb-14 text-center">
        <h1 className="text-6xl font-black text-purple-500 tracking-tighter mb-2 italic">MUSICO</h1>
        <p className="text-white/20 font-black uppercase tracking-[0.4em] text-[10px]">The Social Music Singularity</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4 max-w-sm w-full mx-auto">
        {!isLogin && (
          <input type="text" placeholder="Identity Handle" required className="w-full p-5 bg-white/5 border border-white/10 rounded-2xl outline-none focus:border-purple-500 text-white font-bold placeholder:text-white/20" value={name} onChange={(e) => setName(e.target.value)} />
        )}
        <input type="email" placeholder="Comms Address" required className="w-full p-5 bg-white/5 border border-white/10 rounded-2xl outline-none focus:border-purple-500 text-white font-bold placeholder:text-white/20" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input type="password" placeholder="Access Key" required className="w-full p-5 bg-white/5 border border-white/10 rounded-2xl outline-none focus:border-purple-500 text-white font-bold placeholder:text-white/20" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button disabled={loading} className="w-full py-5 bg-purple-600 rounded-[1.5rem] font-black text-lg hover:bg-purple-700 active:scale-95 transition-all shadow-2xl shadow-purple-900/40 disabled:opacity-50 mt-6 text-white uppercase tracking-widest border border-white/10">
          {loading ? 'Establishing Link...' : (isLogin ? 'Sync Session' : 'Create Identity')}
        </button>
      </form>
      <p className="mt-12 text-center text-white/20 font-black text-[10px] uppercase tracking-widest">
        {isLogin ? "Unregistered Voyager?" : "Known Entity?"}{' '}
        <span onClick={() => setIsLogin(!isLogin)} className="text-purple-500 cursor-pointer ml-2">
          {isLogin ? 'Enter Orbit' : 'Login'}
        </span>
      </p>
    </div>
  );
}

function HomeScreen({ songs, onPlay, currentSong, isPlaying, userData }: { songs: Song[]; onPlay: (s: Song) => void; currentSong: Song | null; isPlaying: boolean; userData: UserData | null }) {
  return (
    <div className="space-y-12 py-6 animate-slide-up">
      <section>
        <div className="h-64 rounded-[3rem] overflow-hidden relative shadow-2xl group">
          <img src="https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?q=80&w=1000&auto=format&fit=crop" alt="Banner" className="w-full h-full object-cover brightness-75 transition-transform duration-[3s] group-hover:scale-110" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0a] via-[#0a0a0a]/30 to-transparent flex flex-col justify-end p-10">
            <span className="bg-white/10 backdrop-blur-md border border-white/10 text-[9px] font-black px-4 py-1.5 rounded-full w-fit mb-4 tracking-[0.3em] uppercase">Hyperdrive Mix</span>
            <h3 className="text-4xl font-black italic leading-none tracking-tighter">Sonic Pulse</h3>
            <p className="text-white/40 text-[10px] mt-4 font-black uppercase tracking-[0.2em]">Synchronized for {userData?.name}</p>
          </div>
        </div>
      </section>

      {!userData?.isPremium && (
        <div className="p-6 bg-gradient-to-br from-yellow-500/5 to-purple-600/5 rounded-[2.5rem] border border-yellow-500/10 flex items-center justify-between shadow-xl">
          <div>
            <h4 className="text-lg font-black text-yellow-500 italic leading-none mb-1">Elite Status</h4>
            <p className="text-[9px] font-black text-white/30 uppercase tracking-widest">Unlimited Vault & High Fidelity</p>
          </div>
          <button className="bg-yellow-500 text-black px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest shadow-lg">Upgrade</button>
        </div>
      )}

      <section>
        <div className="flex justify-between items-center mb-8 px-2">
          <h2 className="text-2xl font-black italic tracking-tighter">New Arrivals</h2>
          <button className="text-[10px] font-black text-purple-500 tracking-widest uppercase bg-purple-500/10 px-4 py-1.5 rounded-full">Scan All</button>
        </div>
        <div className="flex gap-6 overflow-x-auto hide-scrollbar -mx-2 px-2 pb-4">
          {songs.map((song) => (
            <div key={song.id} onClick={() => onPlay(song)} className="flex-shrink-0 w-48 space-y-4 group cursor-pointer">
              <div className="relative aspect-square rounded-[2.5rem] overflow-hidden shadow-2xl border border-white/5">
                <img src={song.img} alt={song.title} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-1000" />
                {currentSong?.id === song.id && isPlaying && (
                   <div className="absolute inset-0 bg-purple-600/30 backdrop-blur-md flex items-center justify-center">
                      <div className="flex gap-2 items-end h-10">
                        <div className="w-1.5 bg-white rounded-full animate-pulse h-4"></div>
                        <div className="w-1.5 bg-white rounded-full animate-pulse h-8 [animation-delay:0.2s]"></div>
                        <div className="w-1.5 bg-white rounded-full animate-pulse h-3 [animation-delay:0.4s]"></div>
                      </div>
                   </div>
                )}
              </div>
              <div className="px-2">
                <p className="text-sm font-black truncate">{song.title}</p>
                <p className="text-[10px] text-white/30 uppercase font-black truncate tracking-widest mt-0.5">{song.artist}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-white/5 rounded-[3rem] p-8 border border-white/5 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/10 blur-[80px]"></div>
        <h2 className="text-xl font-black italic tracking-tighter mb-6">Cosmic Events</h2>
        <div className="flex items-center gap-5 p-5 glass rounded-3xl border border-purple-500/10">
           <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-purple-500 to-indigo-500 flex items-center justify-center shadow-lg">
              <GiftIcon size={24} />
           </div>
           <div className="flex-1">
             <p className="text-[11px] text-white font-bold leading-tight">Gift a sound signal today and earn 2 bonus 🪙 coins back!</p>
             <p className="text-[9px] text-white/30 mt-2 uppercase font-black tracking-widest">Limited Time Window</p>
           </div>
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
    <div className="py-6 space-y-10 animate-slide-up">
      <div className="relative group">
        <div className="absolute left-6 top-1/2 -translate-y-1/2 text-white/20 group-focus-within:text-purple-500 transition-all">
          <SearchIcon size={24} />
        </div>
        <input 
          type="text" 
          placeholder="Scan Frequency..."
          className="w-full py-6 pl-16 pr-6 bg-white/5 border border-white/10 rounded-[2rem] outline-none focus:border-purple-500 focus:bg-white/10 transition-all font-black text-white placeholder:text-white/10"
          value={queryText}
          onChange={(e) => setQueryText(e.target.value)}
        />
      </div>

      <div className="space-y-4">
        {filtered.map(song => (
          <div key={song.id} onClick={() => onPlay(song)} className="flex items-center gap-5 p-4 glass rounded-[2rem] active:scale-95 transition-all border border-transparent hover:border-white/10 shadow-lg">
            <img src={song.img} alt="" className="w-16 h-16 rounded-2xl object-cover shadow-xl" />
            <div className="flex-1 min-w-0">
               <p className="font-black text-base truncate">{song.title}</p>
               <p className="text-[10px] text-purple-400 uppercase font-black truncate tracking-widest">{song.artist}</p>
            </div>
            <div className={`w-12 h-12 flex items-center justify-center rounded-full transition-all ${currentSong?.id === song.id && isPlaying ? 'bg-purple-600 shadow-xl' : 'glass'}`}>
               {currentSong?.id === song.id && isPlaying ? <PauseIcon size={20} /> : <PlayIcon size={20} fill="currentColor" />}
            </div>
          </div>
        ))}
        {queryText && filtered.length === 0 && (
          <div className="py-20 text-center opacity-10">
            <SearchIcon size={80} />
            <p className="mt-4 font-black uppercase tracking-widest">No Signal Found</p>
          </div>
        )}
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
    <div className="py-6 space-y-12 animate-slide-up">
      <h2 className="text-4xl font-black italic tracking-tighter">The Vault</h2>
      
      <div className="grid grid-cols-2 gap-6">
        <div className="bg-gradient-to-br from-red-500 to-pink-700 aspect-square rounded-[3rem] p-8 flex flex-col justify-end shadow-2xl shadow-red-900/20 active:scale-95 transition-transform border border-white/10">
           <span className="text-3xl mb-4">❤️</span>
           <p className="font-black text-2xl leading-none italic">Synced</p>
           <p className="text-[9px] font-black uppercase opacity-60 mt-2 tracking-widest">{likedSongsList.length} Tracks</p>
        </div>
        <div className="bg-gradient-to-br from-purple-600 to-indigo-700 aspect-square rounded-[3rem] p-8 flex flex-col justify-end shadow-2xl shadow-purple-900/20 active:scale-95 transition-transform border border-white/10">
           <span className="text-3xl mb-4">🔒</span>
           <p className="font-black text-2xl leading-none italic">Stored</p>
           <p className="text-[9px] font-black uppercase opacity-60 mt-2 tracking-widest">{offlineSongs.length} Local</p>
        </div>
      </div>

      <section>
        <div className="flex justify-between items-center mb-8 px-2">
          <h3 className="text-[10px] font-black text-white/30 uppercase tracking-[0.4em]">Offline Node</h3>
          <span className="h-0.5 flex-1 mx-4 bg-white/5"></span>
        </div>
        <div className="space-y-4">
           {offlineSongs.map(s => (
             <div key={s.id} onClick={() => onPlay(s)} className="flex items-center gap-5 p-5 glass rounded-[2rem] active:bg-white/10 border border-white/5 transition-colors">
                <img src={s.img} alt="" className="w-16 h-16 rounded-2xl object-cover" />
                <div className="flex-1 min-w-0">
                  <p className="font-black text-base truncate leading-none mb-1">{s.title}</p>
                  <p className="text-[10px] text-white/30 uppercase font-black truncate tracking-widest">{s.artist}</p>
                </div>
                <div className="text-green-500 bg-green-500/10 p-3 rounded-full border border-green-500/10 shadow-lg">
                   <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
                </div>
             </div>
           ))}
           {offlineSongs.length === 0 && (
             <div className="p-16 text-center glass rounded-[3rem] border-dashed border-white/10 opacity-30">
               <DownloadIcon size={48} className="mx-auto mb-4" />
               <p className="text-sm font-black uppercase tracking-widest">Vault Empty</p>
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
    try {
      const q = query(collection(db, 'users'), where('name', '>=', friendSearch), where('name', '<=', friendSearch + '\uf8ff'));
      const snap = await getDocs(q);
      setFoundUsers(snap.docs.map(d => d.data()).filter(u => u.uid !== userData?.uid));
    } catch(e) { console.error(e); }
  };

  const handleLink = async (u: any) => {
    if (!userData) return;
    try {
      await updateDoc(doc(db, 'users', userData.uid), { friends: arrayUnion(u.uid) });
      await updateDoc(doc(db, 'users', u.uid), { friends: arrayUnion(userData.uid) });
      onToast(`Linked with ${u.name}! 🔗`);
    } catch(e) { onToast("Link failed."); }
  };

  return (
    <div className="py-6 animate-slide-up">
      <div className="flex items-center justify-between mb-12 px-2">
        <h2 className="text-4xl font-black italic tracking-tighter">Avatar</h2>
        <button onClick={() => setShowSettings(!showSettings)} className="w-14 h-14 flex items-center justify-center glass rounded-[1.5rem] active:rotate-90 transition-all text-white border border-white/5">
           <SettingsIcon size={28} />
        </button>
      </div>

      {showSettings && (
        <div className="mb-10 p-8 glass rounded-[3rem] border border-white/10 space-y-6 animate-slide-up shadow-2xl">
           <div className="flex items-center justify-between">
              <div>
                <p className="font-black text-sm text-white uppercase tracking-wider leading-none mb-1">Stealth Sync</p>
                <p className="text-[9px] text-white/30 font-black uppercase tracking-widest">Public profiles disabled</p>
              </div>
              <button 
                onClick={() => userData && updateDoc(doc(db, 'users', userData.uid), { isPrivate: !userData.isPrivate })} 
                className={`w-14 h-7 rounded-full transition-all relative ${userData?.isPrivate ? 'bg-purple-600' : 'bg-white/10'}`}
              >
                <div className={`absolute top-1 w-5 h-5 bg-white rounded-full transition-all shadow-md ${userData?.isPrivate ? 'right-1' : 'left-1'}`}></div>
              </button>
           </div>
           {!userData?.isPremium && (
             <button onClick={onUpgrade} className="w-full py-4 bg-yellow-500/10 text-yellow-500 rounded-2xl font-black text-[10px] tracking-widest uppercase border border-yellow-500/20 active:scale-95 transition-transform">
               Ascend to Elite (100 🪙)
             </button>
           )}
           <button onClick={() => signOut(auth)} className="w-full py-4 bg-red-600/10 text-red-500 rounded-2xl font-black text-[10px] tracking-widest uppercase border border-red-500/20 active:scale-95 transition-transform">Terminate Session</button>
        </div>
      )}

      <div className="flex flex-col items-center mb-12">
         <div className="relative">
            <div className="absolute inset-0 bg-purple-500 rounded-full blur-[60px] opacity-20"></div>
            <div className="p-1 rounded-full bg-gradient-to-tr from-purple-500 to-indigo-500 shadow-2xl relative z-10">
              <img 
                src={userData?.img || `https://ui-avatars.com/api/?name=${userData?.name || 'V'}&background=0a0a0a&color=fff&size=256`} 
                className="w-36 h-36 rounded-full border-[6px] border-[#0a0a0a] object-cover" 
                alt="" 
              />
            </div>
            {userData?.isPremium && <div className="absolute bottom-2 right-2 bg-yellow-500 text-black p-2 rounded-xl z-20 border-4 border-[#0a0a0a] shadow-xl animate-bounce"><span className="text-xs font-black italic">ELITE</span></div>}
         </div>
         <h3 className="text-4xl font-black mt-8 tracking-tighter text-white leading-none italic">{userData?.name || 'Voyager'}</h3>
         <p className="text-purple-400 font-black uppercase tracking-[0.3em] text-[9px] mt-4 opacity-60">{userData?.isPremium ? 'Elite Sector Member' : 'Standard Voyager'}</p>
         
         <div className="grid grid-cols-3 w-full max-w-md mt-12 p-8 glass rounded-[3rem] border border-white/5 shadow-xl">
            <div className="text-center border-r border-white/10">
               <p className="font-black text-2xl leading-none italic text-white">{userData?.friends?.length || 0}</p>
               <p className="text-[9px] text-white/20 font-black uppercase tracking-[0.2em] mt-3">Allies</p>
            </div>
            <div className="text-center border-r border-white/10">
               <p className="font-black text-2xl leading-none italic text-white">{userData?.likedSongs?.length || 0}</p>
               <p className="text-[9px] text-white/20 font-black uppercase tracking-[0.2em] mt-3">Hearts</p>
            </div>
            <div className="text-center">
               <p className="font-black text-2xl leading-none italic text-white">{dedications.length}</p>
               <p className="text-[9px] text-white/20 font-black uppercase tracking-[0.2em] mt-3">Gifts</p>
            </div>
         </div>
      </div>

      <div className="flex glass rounded-[1.8rem] p-1.5 mb-10 border border-white/5">
        <button onClick={() => setActiveTab('social')} className={`flex-1 py-4 text-[9px] font-black tracking-[0.2em] uppercase rounded-[1.2rem] transition-all ${activeTab === 'social' ? 'bg-white text-black shadow-xl' : 'text-white/30'}`}>Network</button>
        <button onClick={() => setActiveTab('gifts')} className={`flex-1 py-4 text-[9px] font-black tracking-[0.2em] uppercase rounded-[1.2rem] transition-all ${activeTab === 'gifts' ? 'bg-white text-black shadow-xl' : 'text-white/30'}`}>Gifts</button>
        <button onClick={() => setActiveTab('history')} className={`flex-1 py-4 text-[9px] font-black tracking-[0.2em] uppercase rounded-[1.2rem] transition-all ${activeTab === 'history' ? 'bg-white text-black shadow-xl' : 'text-white/30'}`}>Ledger</button>
      </div>

      <div className="min-h-[400px]">
        {activeTab === 'social' && (
          <div className="space-y-10 animate-slide-up">
            <div className="flex gap-3">
               <input 
                 type="text" 
                 placeholder="Search sector for voyagers..." 
                 className="flex-1 glass rounded-2xl px-6 py-4 outline-none font-black text-sm text-white placeholder:text-white/10"
                 value={friendSearch}
                 onChange={(e) => setFriendSearch(e.target.value)}
               />
               <button onClick={searchFriends} className="bg-purple-600 text-white font-black px-8 rounded-2xl uppercase text-[10px] tracking-widest shadow-lg">Scan</button>
            </div>
            
            {foundUsers.length > 0 && (
              <div className="space-y-4">
                 <h4 className="text-[9px] font-black text-purple-400 uppercase tracking-[0.3em] px-2">Identified Signal</h4>
                 {foundUsers.map(u => (
                   <div key={u.uid} className="flex items-center justify-between p-5 glass rounded-[2rem] border border-white/5 shadow-lg">
                      <div className="flex items-center gap-5">
                        <img src={u.img || `https://ui-avatars.com/api/?name=${u.name}`} className="w-14 h-14 rounded-2xl object-cover shadow-md" />
                        <div>
                          <p className="font-black text-sm text-white uppercase tracking-tight leading-none mb-1">{u.name}</p>
                          <p className="text-[9px] font-black text-white/20 tracking-widest uppercase">{u.isPrivate ? 'Stealth' : 'Visible'}</p>
                        </div>
                      </div>
                      <button onClick={() => handleLink(u)} className="bg-white text-black text-[9px] font-black uppercase px-5 py-2.5 rounded-xl active:scale-95 transition-transform shadow-md">Connect</button>
                   </div>
                 ))}
              </div>
            )}
            
            <div className="space-y-4">
              <h4 className="text-[9px] font-black text-white/20 uppercase tracking-[0.3em] px-2">Active Allies</h4>
              <div className="grid grid-cols-2 gap-4">
                {userData?.friends?.length ? userData.friends.map(fid => (
                  <div key={fid} className="flex flex-col items-center p-6 glass rounded-[2.5rem] border border-white/5">
                    <img src={`https://ui-avatars.com/api/?name=User&background=6366f1&color=fff`} className="w-16 h-16 rounded-full mb-4 border-2 border-white/5" alt="ally" />
                    <span className="text-[10px] font-black text-white/40 uppercase mb-4 tracking-tighter truncate w-full text-center">Voyager Signal</span>
                    <button className="text-[8px] font-black text-purple-400 uppercase tracking-[0.2em] bg-purple-500/10 px-4 py-2 rounded-full hover:bg-purple-500 hover:text-white transition-all">Open Comms</button>
                  </div>
                )) : (
                  <div className="col-span-2 py-16 text-center glass rounded-[2.5rem] border-dashed border-white/5 opacity-10">
                    <p className="text-xs uppercase font-black tracking-[0.2em]">Network Isolated</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'gifts' && (
          <div className="space-y-6 animate-slide-up">
             {dedications.length > 0 ? dedications.map(d => (
               <div key={d.id} className="p-8 glass rounded-[3rem] relative overflow-hidden group border border-purple-500/10 shadow-2xl">
                  <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:scale-110 transition-transform duration-1000"><GiftIcon size={80} /></div>
                  <div className="relative z-10">
                     <p className="text-[9px] font-black text-purple-400 uppercase tracking-[0.4em] mb-4 leading-none">Transmission: {d.fromName}</p>
                     <h5 className="text-3xl font-black leading-tight mb-2 text-white italic tracking-tighter">{d.songTitle}</h5>
                     <p className="text-white/40 text-sm font-medium leading-relaxed italic">"{d.message || "Silent signal."}"</p>
                     <button 
                        // Fixed: Changed 'handlePlay' to 'onPlay' to match the prop passed to ProfileScreen.
                        onClick={() => { const s = songs.find(x => x.id === d.songId); if (s) onPlay(s); }} 
                        className="mt-8 flex items-center gap-3 text-[10px] font-black bg-white text-black px-8 py-4 rounded-[1.5rem] active:scale-95 transition-all shadow-xl hover:bg-purple-500 hover:text-white"
                     >
                        <PlayIcon size={16} fill="currentColor" /> Play Transmission
                     </button>
                  </div>
               </div>
             )) : (
               <div className="py-24 text-center opacity-10">
                 <GiftIcon size={80} className="mx-auto mb-4" />
                 <p className="text-xs font-black uppercase tracking-[0.2em]">No Incoming Gifts</p>
               </div>
             )}
          </div>
        )}

        {activeTab === 'history' && (
           <div className="space-y-4 animate-slide-up">
              {userData?.coinHistory?.slice().reverse().map(tx => (
                <div key={tx.id} className="flex items-center justify-between p-6 glass rounded-[2rem] border border-white/5 shadow-md">
                   <div className="flex-1 min-w-0 pr-4">
                      <p className="text-sm font-black text-white truncate leading-tight mb-1 uppercase tracking-tight">{tx.description}</p>
                      <p className="text-[9px] text-white/20 uppercase font-black tracking-widest">{new Date(tx.timestamp).toLocaleString()}</p>
                   </div>
                   <div className={`font-black text-lg italic ${tx.type === 'earn' ? 'text-green-500' : 'text-red-500'}`}>
                      {tx.type === 'earn' ? '+' : '-'}{tx.amount} 🪙
                   </div>
                </div>
              ))}
              {(!userData?.coinHistory || userData.coinHistory.length === 0) && (
                <p className="text-center py-24 text-white/10 font-black uppercase tracking-[0.2em]">Transaction Ledger Clear</p>
              )}
           </div>
        )}
      </div>
    </div>
  );
}
