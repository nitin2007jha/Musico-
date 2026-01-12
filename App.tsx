
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
  addDoc
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
import { Song, UserData, Dedication } from './types';
import { saveSongOffline, getAllOfflineSongs } from './services/indexedDB';

// --- INITIALIZE AI ---
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || "" });

// --- SHARED COMPONENTS ---

const Toast = ({ message, onClose }: { message: string; onClose: () => void }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);
  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-purple-600 text-white px-6 py-3 rounded-2xl shadow-2xl z-[9999] text-sm font-bold animate-slide-up flex items-center gap-2">
      <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse"></div>
      {message}
    </div>
  );
};

// --- MAIN APP COMPONENT ---

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
  const [songTrivia, setSongTrivia] = useState<string>('');
  const [isTriviaLoading, setIsTriviaLoading] = useState(false);
  
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Sync state with local storage
  useEffect(() => {
    const savedSong = localStorage.getItem('last_played');
    if (savedSong) {
      try {
        setCurrentSong(JSON.parse(savedSong));
      } catch (e) {
        console.error("Failed to load last played song");
      }
    }
  }, []);

  const updateMediaMetadata = useCallback((song: Song) => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: song.title,
        artist: song.artist,
        album: song.album || 'Musico Universe',
        artwork: [{ src: song.img, sizes: '512x512', type: 'image/png' }]
      });

      navigator.mediaSession.setActionHandler('play', () => {
        audioRef.current?.play();
        setIsPlaying(true);
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        audioRef.current?.pause();
        setIsPlaying(false);
      });
    }
  }, []);

  // Fetch Trivia using Gemini
  const fetchTrivia = async (song: Song) => {
    if (!process.env.API_KEY) return;
    setIsTriviaLoading(true);
    setSongTrivia('');
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Provide one extremely interesting, short, and punchy trivia fact about the song "${song.title}" by "${song.artist}". Keep it under 20 words. Format: plain text only.`,
      });
      setSongTrivia(response.text || "No trivia available for this track.");
    } catch (error) {
      setSongTrivia("Discover the magic behind this track in your library.");
    } finally {
      setIsTriviaLoading(false);
    }
  };

  useEffect(() => {
    if (currentSong && isPlayerOpen) {
      fetchTrivia(currentSong);
    }
  }, [currentSong, isPlayerOpen]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (authUser) => {
      if (authUser) {
        setUser(authUser);
        const docRef = doc(db, 'users', authUser.uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setUserData(docSnap.data() as UserData);
        }
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
          const loadedSongs = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Song));
          setSongs(loadedSongs);
        } catch (e) {
          console.error("Error fetching songs:", e);
        }
      };
      fetchSongs();
    }
  }, [user]);

  const handlePlay = (song: Song) => {
    if (currentSong?.id === song.id) {
      if (isPlaying) {
        audioRef.current?.pause();
        setIsPlaying(false);
      } else {
        audioRef.current?.play();
        setIsPlaying(true);
      }
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

  const handleDownload = async (song: Song) => {
    setToastMsg(`Saving ${song.title} to library...`);
    try {
      const response = await fetch(song.url);
      const blob = await response.blob();
      await saveSongOffline(song.id, blob, { title: song.title, artist: song.artist, img: song.img });
      setToastMsg('Saved for offline listening!');
    } catch (error) {
      setToastMsg('Download failed. Check your connection.');
    }
  };

  if (loading) return (
    <div className="h-screen flex items-center justify-center bg-[#0a0a0a]">
      <div className="flex flex-col items-center gap-4">
        <div className="text-4xl font-black text-purple-500 animate-pulse tracking-tighter">MUSICO</div>
      </div>
    </div>
  );

  if (!user) return <AuthScreen onToast={setToastMsg} />;

  return (
    <div className="flex flex-col h-screen bg-[#0a0a0a] overflow-hidden">
      <audio ref={audioRef} onEnded={() => setIsPlaying(false)} />
      
      <header className="px-6 py-5 flex justify-between items-center bg-[#0a0a0a] z-10">
        <div className="flex flex-col">
          <span className="text-2xl font-black text-purple-500 tracking-tighter">MUSICO</span>
          <span className="text-[10px] font-extrabold text-white/40 uppercase tracking-[0.2em]">Music Universe</span>
        </div>
        <div className="flex items-center gap-3 glass px-4 py-2 rounded-2xl">
           <span className="text-yellow-500">🪙</span>
           <span className="text-sm font-black">{userData?.coins || 0}</span>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto pb-40 hide-scrollbar px-6">
        {currentTab === 'home' && <HomeScreen songs={songs} onPlay={handlePlay} currentSong={currentSong} isPlaying={isPlaying} />}
        {currentTab === 'search' && <SearchScreen songs={songs} onPlay={handlePlay} currentSong={currentSong} isPlaying={isPlaying} />}
        {currentTab === 'library' && <LibraryScreen songs={songs} onPlay={handlePlay} />}
        {currentTab === 'profile' && (
          <ProfileScreen 
            userData={userData} 
            songs={songs} 
            onPlay={handlePlay} 
            setUserData={setUserData}
            onToast={setToastMsg}
          />
        )}
      </main>

      {/* Mini Player */}
      {currentSong && !isPlayerOpen && (
        <div 
          onClick={() => setIsPlayerOpen(true)}
          className="fixed bottom-[84px] left-4 right-4 h-16 glass rounded-2xl flex items-center px-3 gap-3 shadow-2xl z-40 cursor-pointer animate-slide-up"
        >
          <img src={currentSong.img} alt="" className="w-10 h-10 rounded-xl object-cover" />
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
        <div className="fixed inset-0 player-gradient z-[100] p-8 flex flex-col animate-slide-up">
          <div className="flex justify-between items-center mb-8">
            <button onClick={() => setIsPlayerOpen(false)} className="w-10 h-10 flex items-center justify-center glass rounded-full">
               <svg className="w-5 h-5 rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"/></svg>
            </button>
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-white/40">Broadcasting</span>
            <button className="w-10 h-10 flex items-center justify-center glass rounded-full">
              <span className="text-xl">⋮</span>
            </button>
          </div>

          <div className="flex-1 flex flex-col items-center justify-center">
             <div className="relative">
                <img src={currentSong.img} alt="" className="w-[80vw] aspect-square rounded-[2rem] object-cover shadow-[0_40px_80px_-20px_rgba(168,85,247,0.3)]" />
                {isPlaying && (
                  <div className="absolute -inset-2 border-2 border-purple-500/30 rounded-[2.2rem] animate-pulse"></div>
                )}
             </div>
             <div className="mt-12 w-full text-center">
                <h2 className="text-3xl font-black leading-tight">{currentSong.title}</h2>
                <p className="text-lg text-purple-400 font-bold mt-1">{currentSong.artist}</p>
             </div>

             {/* AI Trivia Section */}
             <div className="mt-8 w-full glass rounded-2xl p-4 flex flex-col gap-2 min-h-[80px]">
                <div className="flex items-center gap-2">
                   <div className="w-1.5 h-1.5 bg-purple-500 rounded-full animate-pulse"></div>
                   <span className="text-[10px] font-black uppercase tracking-widest text-purple-400">Did you know?</span>
                </div>
                {isTriviaLoading ? (
                  <div className="space-y-2">
                    <div className="h-2 bg-white/5 rounded-full w-full animate-pulse"></div>
                    <div className="h-2 bg-white/5 rounded-full w-2/3 animate-pulse"></div>
                  </div>
                ) : (
                  <p className="text-xs text-white/60 leading-relaxed italic">{songTrivia}</p>
                )}
             </div>
          </div>

          <div className="mt-auto pt-8">
             <div className="flex justify-between items-center mb-10 px-4">
                <button onClick={() => handleDownload(currentSong)} className="text-white/40 active:scale-90 transition-transform">
                  <DownloadIcon size={24} />
                </button>
                <div className="flex items-center gap-8">
                  <button className="text-white/40 active:scale-90 transition-transform"><svg size={28} width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m15 18-6-6 6-6"/></svg></button>
                  <button 
                    onClick={() => handlePlay(currentSong)}
                    className="w-20 h-20 flex items-center justify-center bg-white text-black rounded-full shadow-2xl active:scale-95 transition-transform"
                  >
                    {isPlaying ? <PauseIcon size={32} /> : <PlayIcon size={32} fill="black" />}
                  </button>
                  <button className="text-white/40 active:scale-90 transition-transform"><svg size={28} width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m9 18 6-6-6-6"/></svg></button>
                </div>
                <button className="text-white/40 active:scale-90 transition-transform">
                  <GiftIcon size={24} />
                </button>
             </div>
          </div>
        </div>
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

// --- SUB-SCREENS ---

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
          name: name,
          email: email,
          isPrivate: false,
          coins: 10,
          isPremium: false,
          friends: [],
          friendRequests: []
        });
        onToast("Account created!");
      }
    } catch (err: any) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen bg-[#0a0a0a] p-10 flex flex-col justify-center">
      <div className="mb-12">
        <h1 className="text-5xl font-black text-purple-500 tracking-tighter mb-2">MUSICO</h1>
        <p className="text-white/40 font-bold uppercase tracking-widest text-xs">Enter the Universe</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4 max-w-sm w-full">
        {!isLogin && (
          <input 
            type="text" placeholder="Full Name" required 
            className="w-full p-5 bg-white/5 border border-white/10 rounded-2xl outline-none focus:border-purple-500 transition-all font-medium text-white"
            value={name} onChange={(e) => setName(e.target.value)}
          />
        )}
        <input 
          type="email" placeholder="Email Address" required 
          className="w-full p-5 bg-white/5 border border-white/10 rounded-2xl outline-none focus:border-purple-500 transition-all font-medium text-white"
          value={email} onChange={(e) => setEmail(e.target.value)}
        />
        <input 
          type="password" placeholder="Password" required 
          className="w-full p-5 bg-white/5 border border-white/10 rounded-2xl outline-none focus:border-purple-500 transition-all font-medium text-white"
          value={password} onChange={(e) => setPassword(e.target.value)}
        />
        <button 
          disabled={loading}
          className="w-full py-5 bg-purple-600 rounded-2xl font-black text-lg hover:bg-purple-700 active:scale-95 transition-all shadow-2xl shadow-purple-900/40 disabled:opacity-50 mt-4 text-white"
        >
          {loading ? 'WAITING...' : (isLogin ? 'LOG IN' : 'SIGN UP')}
        </button>
      </form>
      <p className="mt-10 text-center text-white/30 font-bold text-sm">
        {isLogin ? "NEW HERE?" : "ALREADY A MEMBER?"}{' '}
        <span onClick={() => setIsLogin(!isLogin)} className="text-purple-500 cursor-pointer">
          {isLogin ? 'CREATE ACCOUNT' : 'LOG IN'}
        </span>
      </p>
    </div>
  );
}

function HomeScreen({ songs, onPlay, currentSong, isPlaying }: { songs: Song[]; onPlay: (s: Song) => void; currentSong: Song | null; isPlaying: boolean }) {
  return (
    <div className="space-y-10 py-4 animate-slide-up">
      <section>
        <div className="h-56 rounded-[2.5rem] overflow-hidden relative shadow-2xl">
          <img src="https://images.unsplash.com/photo-1470225620780-dba8ba36b745?q=80&w=1000&auto=format&fit=crop" alt="Banner" className="w-full h-full object-cover brightness-50" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent flex flex-col justify-end p-8">
            <span className="bg-purple-600 text-[10px] font-black px-3 py-1 rounded-full w-fit mb-3 tracking-widest uppercase">Editor's Pick</span>
            <h3 className="text-3xl font-black leading-none">Sonic Horizon</h3>
            <p className="text-white/60 text-sm mt-2 font-medium">Step into the future of sound</p>
          </div>
        </div>
      </section>

      <section>
        <div className="flex justify-between items-end mb-6">
          <h2 className="text-2xl font-black italic tracking-tighter">Rising Stars</h2>
          <button className="text-[10px] font-black text-purple-500 tracking-widest uppercase">See All</button>
        </div>
        <div className="flex gap-5 overflow-x-auto hide-scrollbar -mx-2 px-2">
          {songs.slice(0, 6).map((song) => (
            <div 
              key={song.id} 
              onClick={() => onPlay(song)}
              className="flex-shrink-0 w-40 space-y-3 group cursor-pointer"
            >
              <div className="relative aspect-square rounded-[2rem] overflow-hidden shadow-xl border border-white/5">
                <img src={song.img} alt={song.title} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" />
                {currentSong?.id === song.id && isPlaying && (
                   <div className="absolute inset-0 bg-purple-600/30 backdrop-blur-sm flex items-center justify-center">
                      <div className="flex gap-1.5 items-end h-8">
                        <div className="w-1 bg-white rounded-full animate-pulse h-4"></div>
                        <div className="w-1 bg-white rounded-full animate-pulse h-6"></div>
                        <div className="w-1 bg-white rounded-full animate-pulse h-3"></div>
                      </div>
                   </div>
                )}
              </div>
              <div className="px-1">
                <p className="text-sm font-black truncate">{song.title}</p>
                <p className="text-[10px] text-white/40 uppercase font-black truncate">{song.artist}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-2xl font-black italic tracking-tighter mb-6">Daily Top 10</h2>
        <div className="space-y-2">
          {songs.slice(0, 5).map((song, i) => (
            <div 
              key={song.id} 
              onClick={() => onPlay(song)}
              className={`flex items-center gap-4 p-4 rounded-3xl transition-all ${currentSong?.id === song.id ? 'bg-purple-600/10 border border-purple-500/20' : 'bg-white/5 border border-transparent active:bg-white/10'}`}
            >
              <span className="text-white/10 font-black text-2xl w-8 text-center">{i + 1}</span>
              <img src={song.img} alt="" className="w-14 h-14 rounded-2xl object-cover shadow-lg" />
              <div className="flex-1">
                 <p className="font-black text-sm truncate">{song.title}</p>
                 <p className="text-[10px] text-white/40 uppercase font-black truncate">{song.artist}</p>
              </div>
              <div className={`w-10 h-10 flex items-center justify-center rounded-full ${currentSong?.id === song.id ? 'bg-purple-500 text-white' : 'bg-white/5 text-white/20'}`}>
                {currentSong?.id === song.id && isPlaying ? <PauseIcon size={16} /> : <PlayIcon size={16} fill="currentColor" />}
              </div>
            </div>
          ))}
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
      <div className="relative">
        <div className="absolute left-5 top-1/2 -translate-y-1/2 text-white/20">
          <SearchIcon size={24} />
        </div>
        <input 
          type="text" 
          placeholder="Search Universe..."
          className="w-full py-5 pl-14 pr-6 bg-white/5 border border-white/10 rounded-3xl outline-none focus:border-purple-500 focus:bg-white/10 transition-all font-bold text-white"
          value={queryText}
          onChange={(e) => setQueryText(e.target.value)}
        />
      </div>

      <div className="space-y-3">
        {filtered.map(song => (
          <div 
            key={song.id} 
            onClick={() => onPlay(song)}
            className="flex items-center gap-4 p-4 glass rounded-3xl active:scale-95 transition-transform"
          >
            <img src={song.img} alt="" className="w-16 h-16 rounded-2xl object-cover shadow-xl" />
            <div className="flex-1">
               <p className="font-black text-base truncate">{song.title}</p>
               <p className="text-[10px] text-purple-400 uppercase font-black truncate">{song.artist}</p>
            </div>
            <div className="w-12 h-12 flex items-center justify-center glass rounded-full">
               {currentSong?.id === song.id && isPlaying ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
            </div>
          </div>
        ))}
        {queryText && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-32 opacity-20 text-white">
             <SearchIcon size={64} />
             <p className="mt-4 font-black uppercase tracking-widest text-sm">Lost in Space</p>
          </div>
        )}
      </div>
    </div>
  );
}

function LibraryScreen({ songs, onPlay }: { songs: Song[]; onPlay: (s: Song) => void }) {
  const [offlineSongs, setOfflineSongs] = useState<any[]>([]);

  useEffect(() => {
    getAllOfflineSongs().then(setOfflineSongs);
  }, []);

  return (
    <div className="py-4 space-y-10 animate-slide-up">
      <h2 className="text-4xl font-black italic tracking-tighter">Your Library</h2>
      
      <section>
        <div className="flex justify-between items-center mb-6">
           <h3 className="text-[10px] font-black text-white/40 uppercase tracking-[0.2em]">Stored Offline</h3>
           <span className="text-[10px] font-black bg-white/10 px-3 py-1 rounded-full text-white">{offlineSongs.length} Tracks</span>
        </div>
        <div className="space-y-3">
           {offlineSongs.map(s => (
             <div key={s.id} onClick={() => onPlay(s)} className="flex items-center gap-4 p-4 glass rounded-3xl active:bg-white/5">
                <img src={s.img} alt="" className="w-14 h-14 rounded-2xl object-cover" />
                <div className="flex-1">
                  <p className="font-black text-sm truncate">{s.title}</p>
                  <p className="text-[10px] text-white/40 uppercase font-black truncate">{s.artist}</p>
                </div>
                <div className="text-green-500 w-8 h-8 flex items-center justify-center bg-green-500/10 rounded-full">
                   <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
                </div>
             </div>
           ))}
           {offlineSongs.length === 0 && (
             <div className="p-8 text-center glass rounded-3xl border-dashed border-white/10">
               <p className="text-white/20 italic text-sm">Offline storage is empty.</p>
             </div>
           )}
        </div>
      </section>

      <section>
        <div className="flex justify-between items-center mb-6">
           <h3 className="text-[10px] font-black text-white/40 uppercase tracking-[0.2em]">Collections</h3>
        </div>
        <div className="grid grid-cols-2 gap-5">
           <div className="bg-gradient-to-br from-purple-600 to-indigo-700 aspect-square rounded-[2rem] p-6 flex flex-col justify-end shadow-xl shadow-purple-900/20 active:scale-95 transition-transform text-white">
              <span className="text-3xl mb-2">❤️</span>
              <p className="font-black text-lg leading-none">Liked<br/>Songs</p>
           </div>
           <div className="bg-white/5 aspect-square rounded-[2rem] p-6 flex flex-col justify-end border border-white/10 active:scale-95 transition-transform text-white">
              <span className="text-3xl mb-2">🕒</span>
              <p className="font-black text-lg leading-none">Recent<br/>History</p>
           </div>
        </div>
      </section>
    </div>
  );
}

function ProfileScreen({ userData, songs, onPlay, setUserData, onToast }: { userData: UserData | null; songs: Song[]; onPlay: (s: Song) => void; setUserData: any; onToast: (m: string) => void }) {
  const [activeTab, setActiveTab] = useState<'playlists' | 'friends' | 'dedications'>('playlists');
  const [showSettings, setShowSettings] = useState(false);
  const [friendSearch, setFriendSearch] = useState('');
  const [foundUsers, setFoundUsers] = useState<any[]>([]);
  const [dedications, setDedications] = useState<Dedication[]>([]);

  useEffect(() => {
    if (!userData?.uid) return;
    const q = query(collection(db, 'dedications'), where('toUid', '==', userData.uid));
    const unsubscribe = onSnapshot(q, (snap) => {
      setDedications(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Dedication)));
    }, (err) => console.error("Snapshot error:", err));
    return unsubscribe;
  }, [userData?.uid]);

  const searchFriends = async () => {
    if (friendSearch.length < 2) return;
    try {
      const q = query(collection(db, 'users'), where('name', '>=', friendSearch), where('name', '<=', friendSearch + '\uf8ff'));
      const snap = await getDocs(q);
      setFoundUsers(snap.docs.map(d => d.data()).filter(u => u.uid !== userData?.uid));
    } catch (e) {
      console.error(e);
    }
  };

  const togglePrivacy = async () => {
    if (!userData?.uid) return;
    const newStatus = !userData.isPrivate;
    try {
      await updateDoc(doc(db, 'users', userData.uid), { isPrivate: newStatus });
      setUserData({ ...userData, isPrivate: newStatus });
      onToast(`Account is now ${newStatus ? 'Private' : 'Public'}`);
    } catch (e) {
      onToast("Update failed.");
    }
  };

  const handleAddFriend = async (targetUid: string) => {
    if (!userData?.uid) return;
    try {
      await updateDoc(doc(db, 'users', userData.uid), { friends: arrayUnion(targetUid) });
      await updateDoc(doc(db, 'users', targetUid), { friends: arrayUnion(userData.uid) });
      onToast("Friend connected!");
    } catch (e) {
      onToast("Failed to add friend.");
    }
  };

  const sendDedicationSample = async (targetUid: string) => {
    if (!userData?.uid || !songs.length) return;
    const randomSong = songs[Math.floor(Math.random() * songs.length)];
    try {
      await addDoc(collection(db, 'dedications'), {
        fromUid: userData.uid,
        fromName: userData.name,
        toUid: targetUid,
        songId: randomSong.id,
        songTitle: randomSong.title,
        message: "Check out this banger! 🚀",
        timestamp: Date.now()
      });
      onToast(`Dedicated ${randomSong.title}!`);
    } catch (e) {
      onToast("Dedication failed.");
    }
  };

  return (
    <div className="py-4 animate-slide-up">
      <div className="flex items-center justify-between mb-10">
        <h2 className="text-4xl font-black italic tracking-tighter">Universe Identity</h2>
        <button onClick={() => setShowSettings(!showSettings)} className="w-12 h-12 flex items-center justify-center glass rounded-2xl active:rotate-90 transition-all text-white">
           <SettingsIcon size={24} />
        </button>
      </div>

      {showSettings && (
        <div className="mb-10 p-8 glass rounded-[2.5rem] space-y-6 animate-slide-up">
           <h4 className="text-[10px] font-black text-white/40 uppercase tracking-[0.3em]">Identity Settings</h4>
           <div className="flex items-center justify-between">
              <div>
                <p className="font-black text-sm text-white">Ghost Mode (Private)</p>
                <p className="text-[10px] text-white/40 font-bold">Only friends can see your activity</p>
              </div>
              <button 
                onClick={togglePrivacy}
                className={`w-14 h-7 rounded-full transition-all relative ${userData?.isPrivate ? 'bg-purple-600' : 'bg-white/10'}`}
              >
                <div className={`absolute top-1 w-5 h-5 bg-white rounded-full transition-all shadow-lg ${userData?.isPrivate ? 'right-1' : 'left-1'}`}></div>
              </button>
           </div>
           <button onClick={() => signOut(auth)} className="w-full py-4 bg-red-600 text-white rounded-2xl font-black text-sm tracking-widest uppercase active:scale-95 transition-transform">Sign Out</button>
        </div>
      )}

      <div className="flex flex-col items-center mb-10">
         <div className="relative group">
            <div className="absolute inset-0 bg-purple-500 rounded-full blur-2xl opacity-20 group-hover:opacity-40 transition-opacity"></div>
            <img 
              src={userData?.img || `https://ui-avatars.com/api/?name=${userData?.name || 'User'}&background=6366f1&color=fff&size=256`} 
              className="w-32 h-32 rounded-full border-[6px] border-[#0a0a0a] ring-2 ring-white/10 shadow-2xl object-cover relative z-10" 
              alt="" 
            />
         </div>
         <h3 className="text-3xl font-black mt-6 tracking-tight text-white">{userData?.name || 'New Voyager'}</h3>
         <p className="text-purple-400 font-black uppercase tracking-[0.2em] text-[10px] mt-1">{userData?.isPremium ? 'Premium Voyager' : 'Musico Member'}</p>
         
         <div className="grid grid-cols-3 w-full max-w-sm mt-10 p-6 glass rounded-[2rem] text-white">
            <div className="text-center border-r border-white/5">
               <p className="font-black text-xl leading-none">{userData?.friends?.length || 0}</p>
               <p className="text-[9px] text-white/40 font-black uppercase tracking-widest mt-2">Friends</p>
            </div>
            <div className="text-center border-r border-white/5">
               <p className="font-black text-xl leading-none">12</p>
               <p className="text-[9px] text-white/40 font-black uppercase tracking-widest mt-2">Saved</p>
            </div>
            <div className="text-center">
               <p className="font-black text-xl leading-none">{dedications.length}</p>
               <p className="text-[9px] text-white/40 font-black uppercase tracking-widest mt-2">Received</p>
            </div>
         </div>
      </div>

      <div className="flex glass rounded-2xl p-1.5 mb-8">
        <button onClick={() => setActiveTab('playlists')} className={`flex-1 py-3 text-[10px] font-black tracking-[0.2em] uppercase rounded-xl transition-all ${activeTab === 'playlists' ? 'bg-white text-black shadow-lg' : 'text-white/40'}`}>Collections</button>
        <button onClick={() => setActiveTab('friends')} className={`flex-1 py-3 text-[10px] font-black tracking-[0.2em] uppercase rounded-xl transition-all ${activeTab === 'friends' ? 'bg-white text-black shadow-lg' : 'text-white/40'}`}>Social</button>
        <button onClick={() => setActiveTab('dedications')} className={`flex-1 py-3 text-[10px] font-black tracking-[0.2em] uppercase rounded-xl transition-all ${activeTab === 'dedications' ? 'bg-white text-black shadow-lg' : 'text-white/40'}`}>Gifts</button>
      </div>

      <div className="min-h-[300px]">
      {activeTab === 'playlists' && (
        <div className="grid grid-cols-2 gap-5">
          <div className="aspect-[4/5] glass rounded-[2rem] flex flex-col items-center justify-center border-2 border-dashed border-white/5 group cursor-pointer hover:border-purple-500/50 transition-all active:scale-95">
            <div className="w-12 h-12 flex items-center justify-center bg-white/5 rounded-full group-hover:bg-purple-500 transition-colors">
              <span className="text-2xl font-black group-hover:text-white text-white">+</span>
            </div>
            <p className="text-[10px] font-black text-white/20 uppercase tracking-widest mt-4 group-hover:text-purple-500 transition-colors">Construct Playlist</p>
          </div>
        </div>
      )}

      {activeTab === 'friends' && (
        <div className="space-y-8 animate-slide-up">
          <div className="flex gap-2">
             <input 
               type="text" 
               placeholder="Search Voyagers..." 
               className="flex-1 glass rounded-2xl p-4 outline-none font-bold placeholder:text-white/20 text-white"
               value={friendSearch}
               onChange={(e) => setFriendSearch(e.target.value)}
             />
             <button onClick={searchFriends} className="bg-white text-black font-black px-6 rounded-2xl hover:bg-purple-500 hover:text-white transition-colors">GO</button>
          </div>
          
          {foundUsers.length > 0 && (
            <div className="space-y-3">
               <h4 className="text-[10px] font-black text-purple-400 uppercase tracking-widest">Found in Orbit</h4>
               {foundUsers.map(u => (
                 <div key={u.uid} className="flex items-center justify-between p-4 glass rounded-3xl">
                    <div className="flex items-center gap-4">
                      <img src={u.img || `https://ui-avatars.com/api/?name=${u.name}`} className="w-12 h-12 rounded-2xl object-cover" />
                      <div>
                        <p className="font-black text-sm text-white">{u.name}</p>
                        <p className="text-[10px] font-black text-white/30 uppercase">{u.isPrivate ? 'GHOST' : 'VISIBLE'}</p>
                      </div>
                    </div>
                    <button onClick={() => handleAddFriend(u.uid)} className="bg-purple-600 text-white text-[10px] font-black uppercase px-4 py-2 rounded-xl active:scale-90 transition-transform">Connect</button>
                 </div>
               ))}
            </div>
          )}

          <div className="space-y-4">
            <h4 className="text-[10px] font-black text-white/40 uppercase tracking-widest">Connected Friends</h4>
            <div className="grid grid-cols-2 gap-4">
               {userData?.friends?.map(fid => (
                 <div key={fid} className="flex items-center gap-3 p-3 glass rounded-2xl">
                    <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center overflow-hidden">
                       <img src={`https://ui-avatars.com/api/?name=User&background=6366f1&color=fff`} className="w-full h-full object-cover" />
                    </div>
                    <div className="flex-1 min-w-0">
                       <p className="text-[11px] font-black truncate uppercase text-white">VOYAGER</p>
                       <button onClick={() => sendDedicationSample(fid)} className="text-[9px] font-black text-purple-400 uppercase tracking-widest hover:text-white transition-colors flex items-center gap-1 mt-0.5">
                         <GiftIcon size={10} /> Dedicate
                       </button>
                    </div>
                 </div>
               ))}
               {(!userData?.friends || userData.friends.length === 0) && <p className="col-span-2 text-center py-10 glass rounded-3xl text-white/20 italic text-sm">No connections yet.</p>}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'dedications' && (
        <div className="space-y-5 animate-slide-up">
           {dedications.map(d => (
             <div key={d.id} className="p-6 glass rounded-[2.5rem] relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-5 opacity-5 group-hover:scale-150 transition-transform duration-700 text-purple-500"><GiftIcon size={64} /></div>
                <div className="relative z-10">
                   <p className="text-[10px] font-black text-purple-400 uppercase tracking-[0.3em] mb-2">SIGNAL FROM {d.fromName}</p>
                   <h5 className="text-2xl font-black leading-tight mb-2 text-white">{d.songTitle}</h5>
                   <p className="text-white/40 text-sm italic font-medium">"{d.message}"</p>
                   <button 
                     onClick={() => {
                       const song = songs.find(s => s.id === d.songId);
                       if (song) onPlay(song);
                     }}
                     className="mt-6 flex items-center gap-2 text-[10px] font-black bg-white text-black px-6 py-3 rounded-2xl hover:bg-purple-500 hover:text-white transition-all shadow-xl active:scale-95"
                   >
                      <PlayIcon size={14} fill="currentColor" /> INITIATE PLAYBACK
                   </button>
                </div>
             </div>
           ))}
           {dedications.length === 0 && (
              <div className="py-20 flex flex-col items-center opacity-10">
                 <GiftIcon size={80} color="white" />
                 <p className="mt-4 font-black uppercase tracking-widest text-xs text-white">Inbox Empty</p>
              </div>
           )}
        </div>
      )}
      </div>
    </div>
  );
}
