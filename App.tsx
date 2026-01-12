
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
  limit
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
import { Song, UserData, Dedication, CoinTransaction, Playlist } from './types';
import { saveSongOffline, getAllOfflineSongs } from './services/indexedDB';

// --- INITIALIZE AI ---
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
    <div className="fixed bottom-28 left-1/2 -translate-x-1/2 bg-accent text-white px-6 py-3 rounded-2xl shadow-2xl z-[9999] text-sm font-bold animate-slide-up flex items-center gap-2 border border-white/20 whitespace-nowrap">
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
  const [allPlaylists, setAllPlaylists] = useState<Playlist[]>([]);
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [isPlayerOpen, setIsPlayerOpen] = useState(false);
  const [isDedicateModalOpen, setIsDedicateModalOpen] = useState(false);
  const [isPlaylistModalOpen, setIsPlaylistModalOpen] = useState(false);
  const [isAddToPlaylistOpen, setIsAddToPlaylistOpen] = useState(false);
  const [songTrivia, setSongTrivia] = useState<string>('');
  const [isTriviaLoading, setIsTriviaLoading] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Apply theme to document
  useEffect(() => {
    if (userData?.theme) {
      document.documentElement.setAttribute('data-theme', userData.theme);
    } else {
      document.documentElement.setAttribute('data-theme', 'default');
    }
  }, [userData?.theme]);

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

  const fetchTrivia = useCallback(async (song: Song) => {
    if (!process.env.API_KEY || !isPlayerOpen) return;
    setIsTriviaLoading(true);
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Fact check: "${song.title}" by "${song.artist}". Give one very short cool fact (10 words max). No markdown.`,
      });
      setSongTrivia(response.text || "Synchronizing with cosmic vibes...");
    } catch (error) {
      setSongTrivia("Discovering new frequencies of sound.");
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
        
        // Fetch playlists owned by user or public
        const qPlaylists = query(collection(db, 'playlists'), where('ownerId', '==', authUser.uid));
        onSnapshot(qPlaylists, (snap) => {
          setAllPlaylists(snap.docs.map(d => ({ id: d.id, ...d.data() } as Playlist)));
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
        } catch (e) { console.error(e); }
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
        audioRef.current.play().catch(() => {}); 
        setIsPlaying(true); 
      }
    } else {
      setCurrentSong(song);
      localStorage.setItem('musico_last_song', JSON.stringify(song));
      audioRef.current.src = song.url;
      audioRef.current.load();
      audioRef.current.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
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
      type, amount, description, timestamp: Date.now()
    };
    try {
      await updateDoc(doc(db, 'users', userData.uid), {
        coins: increment(type === 'earn' ? amount : -amount),
        coinHistory: arrayUnion(newTx)
      });
      return true;
    } catch (e) { return false; }
  };

  const handleLike = async (songId: string) => {
    if (!userData) return;
    const isLiked = userData.likedSongs?.includes(songId);
    await updateDoc(doc(db, 'users', userData.uid), {
      likedSongs: isLiked ? userData.likedSongs.filter(id => id !== songId) : arrayUnion(songId)
    });
    setToastMsg(isLiked ? "Removed from Favorites" : "Added to Favorites ❤️");
  };

  const handleDownload = async (song: Song) => {
    if (!userData?.isPremium && userData?.coins! < 5) {
      setToastMsg("Elite Access or 5 coins required 🪙");
      return;
    }
    setToastMsg(`Transmitting ${song.title} to vault...`);
    try {
      const response = await fetch(song.url);
      const blob = await response.blob();
      await saveSongOffline(song.id, blob, { ...song });
      if (!userData?.isPremium) await processTransaction(5, `Downloaded: ${song.title}`, 'spend');
      setToastMsg('Securely vaulted offline! 🔒');
    } catch (error) { setToastMsg('Transmission failure.'); }
  };

  const relatedSongs = useMemo(() => {
    if (!currentSong) return [];
    return songs.filter(s => s.id !== currentSong.id && (s.artist === currentSong.artist || (s.album && s.album === currentSong.album))).slice(0, 6);
  }, [currentSong, songs]);

  if (loading) return (
    <div className="h-screen flex items-center justify-center bg-[#0a0a0a]">
       <div className="text-4xl font-black text-accent animate-pulse italic tracking-tighter">MUSICO</div>
    </div>
  );

  if (!user) return <AuthScreen onToast={setToastMsg} />;

  return (
    <div className="flex flex-col h-screen bg-base overflow-hidden text-white transition-all">
      <audio ref={audioRef} onEnded={() => setIsPlaying(false)} onTimeUpdate={(e) => setAudioProgress(e.currentTarget.currentTime)} onLoadedMetadata={(e) => setAudioDuration(e.currentTarget.duration)} />
      
      <header className="px-6 pt-12 pb-4 flex justify-between items-center bg-[#0a0a0a] z-10 sticky top-0">
        <div className="flex flex-col">
          <span className="text-2xl font-black text-accent tracking-tighter italic">MUSICO</span>
          <span className="text-[9px] font-black text-white/30 uppercase tracking-widest mt-1">Galaxy Stream v3.5</span>
        </div>
        <div className="flex items-center gap-4">
           <div className="flex items-center gap-2 glass px-3 py-1.5 rounded-xl border border-white/5 shadow-lg">
             <span className="text-yellow-500 animate-pulse text-sm">🪙</span>
             <span className="text-xs font-black">{userData?.coins || 0}</span>
           </div>
           {userData?.isPremium && <div className="text-[10px] font-black bg-accent px-3 py-1 rounded-lg italic shadow-accent/20 shadow-md">ELITE</div>}
        </div>
      </header>

      <main className="flex-1 overflow-y-auto pb-44 hide-scrollbar px-6">
        {currentTab === 'home' && <HomeScreen songs={songs} playlists={allPlaylists} onPlay={handlePlay} currentSong={currentSong} isPlaying={isPlaying} userData={userData} />}
        {currentTab === 'search' && <SearchScreen songs={songs} onPlay={handlePlay} currentSong={currentSong} isPlaying={isPlaying} />}
        {currentTab === 'library' && <LibraryScreen songs={songs} playlists={allPlaylists} onPlay={handlePlay} userData={userData} onCreatePlaylist={() => setIsPlaylistModalOpen(true)} />}
        {currentTab === 'profile' && <ProfileScreen userData={userData} onToast={setToastMsg} />}
      </main>

      {/* Mini Player */}
      {currentSong && !isPlayerOpen && (
        <div onClick={() => setIsPlayerOpen(true)} className="fixed bottom-[100px] left-4 right-4 h-16 glass rounded-2xl flex items-center px-4 gap-4 shadow-2xl z-40 border border-white/5 animate-slide-up hover:bg-white/5 transition-colors cursor-pointer">
          <img src={currentSong.img} alt="" className="w-10 h-10 rounded-xl object-cover shadow-lg" />
          <div className="flex-1 overflow-hidden">
            <div className="text-xs font-bold truncate">{currentSong.title}</div>
            <div className="text-[9px] text-white/40 uppercase font-black truncate">{currentSong.artist}</div>
          </div>
          <button onClick={(e) => { e.stopPropagation(); handlePlay(currentSong); }} className="w-10 h-10 flex items-center justify-center bg-white text-black rounded-full shadow-lg active:scale-90 transition-transform">
            {isPlaying ? <PauseIcon size={16} /> : <PlayIcon size={16} fill="black" />}
          </button>
        </div>
      )}

      {/* Full Player Overlay */}
      {isPlayerOpen && currentSong && (
        <div className="fixed inset-0 bg-[#0a0a0a] z-[100] flex flex-col animate-slide-up overflow-y-auto hide-scrollbar">
          <div className="absolute inset-0 player-gradient opacity-60"></div>
          <div className="relative z-10 flex flex-col min-h-full p-8">
            <div className="flex justify-between items-center mb-6">
              <button onClick={() => setIsPlayerOpen(false)} className="w-10 h-10 flex items-center justify-center glass rounded-full hover:scale-110 active:scale-90 transition-transform">
                 <svg className="w-5 h-5 rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5"/></svg>
              </button>
              <span className="text-[10px] font-black uppercase tracking-[0.3em] text-white/30">Sonic Singularity</span>
              <button onClick={() => setIsAddToPlaylistOpen(true)} className="w-10 h-10 flex items-center justify-center glass rounded-full hover:scale-110 active:scale-90 transition-transform">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 4v16m8-8H4" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"/></svg>
              </button>
            </div>

            <div className="flex-1 flex flex-col items-center justify-center py-6">
              <div className="relative mb-10">
                  <img src={currentSong.img} alt="" className="w-[85vw] aspect-square rounded-[3rem] object-cover shadow-[0_50px_100px_-20px_var(--accent-glow)] border border-white/10" />
                  {isPlaying && <div className="absolute -inset-4 border-2 border-accent/20 rounded-[3.2rem] animate-pulse-accent"></div>}
              </div>
              
              <div className="w-full flex justify-between items-center mb-8 px-2">
                  <div className="flex-1 min-w-0 pr-6">
                    <h2 className="text-3xl font-black leading-tight truncate italic">{currentSong.title}</h2>
                    <p className="text-lg text-accent font-bold uppercase tracking-wider truncate opacity-80">{currentSong.artist}</p>
                  </div>
                  <button onClick={() => handleLike(currentSong.id)} className={`w-14 h-14 flex items-center justify-center glass rounded-[1.5rem] transition-all ${userData?.likedSongs?.includes(currentSong.id) ? 'text-red-500 bg-red-500/10' : 'text-white/20'}`}>
                    <svg className="w-7 h-7" fill={userData?.likedSongs?.includes(currentSong.id) ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24"><path d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5"/></svg>
                  </button>
              </div>

              <div className="w-full mb-10 px-2">
                <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden relative border border-white/5">
                  <div className="h-full bg-accent shadow-[0_0_15px_var(--accent-glow)] transition-all duration-300" style={{ width: `${(audioProgress/audioDuration)*100}%` }}></div>
                </div>
                <div className="flex justify-between mt-3 text-[10px] font-black text-white/20 uppercase tracking-[0.2em]">
                  <span>{formatTime(audioProgress)}</span>
                  <span>{formatTime(audioDuration)}</span>
                </div>
              </div>

              <div className="w-full glass rounded-[2rem] p-6 border border-white/5 mb-10 min-h-[80px]">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-2 h-2 bg-accent rounded-full animate-pulse"></div>
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-accent">AI Chronicle</span>
                  </div>
                  {isTriviaLoading ? (
                    <div className="space-y-2 animate-pulse">
                      <div className="h-2 bg-white/10 rounded-full w-full"></div>
                      <div className="h-2 bg-white/10 rounded-full w-2/3"></div>
                    </div>
                  ) : <p className="text-sm text-white/60 font-semibold italic">"{songTrivia}"</p>}
              </div>

              <div className="w-full flex justify-between items-center px-4 mb-12">
                  <button onClick={() => handleDownload(currentSong)} className="w-14 h-14 flex items-center justify-center glass rounded-2xl text-white/30 hover:text-white active:scale-90 transition-all">
                    <DownloadIcon size={24} />
                  </button>
                  <div className="flex items-center gap-8">
                    <button className="text-white/20 hover:text-white active:scale-75 transition-transform"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m15 18-6-6 6-6"/></svg></button>
                    <button onClick={() => handlePlay(currentSong)} className="w-24 h-24 flex items-center justify-center bg-white text-black rounded-full shadow-2xl active:scale-90 transition-transform">
                      {isPlaying ? <PauseIcon size={36} /> : <PlayIcon size={36} fill="black" />}
                    </button>
                    <button className="text-white/20 hover:text-white active:scale-75 transition-transform"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m9 18 6-6-6-6"/></svg></button>
                  </div>
                  <button onClick={() => setIsDedicateModalOpen(true)} className="w-14 h-14 flex items-center justify-center bg-accent rounded-2xl text-white shadow-xl shadow-accent/20 active:scale-90 transition-all">
                    <GiftIcon size={24} />
                  </button>
              </div>

              {/* Related Section */}
              {relatedSongs.length > 0 && (
                <div className="w-full mt-10 mb-10">
                   <h3 className="text-xs font-black uppercase tracking-widest mb-6 opacity-40">Frequency Matches (Artist/Album)</h3>
                   <div className="grid grid-cols-1 gap-4">
                      {relatedSongs.map(s => (
                        <div key={s.id} onClick={() => handlePlay(s)} className="flex items-center gap-4 p-4 glass rounded-3xl active:bg-white/5 transition-colors group cursor-pointer border border-transparent hover:border-white/5">
                           <img src={s.img} className="w-14 h-14 rounded-2xl object-cover shadow-md group-hover:scale-105 transition-transform" />
                           <div className="flex-1 truncate">
                              <p className="text-sm font-black truncate mb-0.5">{s.title}</p>
                              <p className="text-[10px] text-white/40 uppercase font-black truncate">{s.artist}</p>
                           </div>
                           <PlayIcon size={18} className="text-accent" />
                        </div>
                      ))}
                   </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODALS */}
      {isPlaylistModalOpen && <PlaylistModal onClose={() => setIsPlaylistModalOpen(false)} onToast={setToastMsg} />}
      {isAddToPlaylistOpen && currentSong && <AddToPlaylistModal song={currentSong} playlists={allPlaylists} onClose={() => setIsAddToPlaylistOpen(false)} onToast={setToastMsg} />}
      {isDedicateModalOpen && currentSong && <DedicateModal song={currentSong} userData={userData} onClose={() => setIsDedicateModalOpen(false)} onSend={async (targetUid, msg) => {
          const success = await processTransaction(5, `Gifting: ${currentSong.title}`, 'spend');
          if (success) {
            await addDoc(collection(db, 'dedications'), { fromUid: userData!.uid, fromName: userData!.name, toUid: targetUid, songId: currentSong.id, songTitle: currentSong.title, message: msg, timestamp: Date.now() });
            setToastMsg("Sonic gift transmitted! 🚀");
            setIsDedicateModalOpen(false);
          }
      }} />}

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 h-[94px] bg-[#0a0a0a]/90 backdrop-blur-3xl border-t border-white/5 flex items-center justify-around z-[50] px-6 pb-safe">
        <NavItem active={currentTab === 'home'} icon={<HomeIcon size={24} />} label="Orbit" onClick={() => setCurrentTab('home')} />
        <NavItem active={currentTab === 'search'} icon={<SearchIcon size={24} />} label="Echo" onClick={() => setCurrentTab('search')} />
        <NavItem active={currentTab === 'library'} icon={<LibraryIcon size={24} />} label="Vault" onClick={() => setCurrentTab('library')} />
        <NavItem active={currentTab === 'profile'} icon={<ProfileIcon size={24} />} label="Me" onClick={() => setCurrentTab('profile')} />
      </nav>

      {toastMsg && <Toast message={toastMsg} onClose={() => setToastMsg('')} />}
    </div>
  );
}

// --- SUB COMPONENTS ---

const NavItem = ({ active, icon, label, onClick }: any) => (
  <button onClick={onClick} className={`flex flex-col items-center gap-1.5 transition-all ${active ? 'text-accent scale-110 font-black' : 'text-white/20 hover:text-white/40'}`}>
    {icon} <span className="text-[9px] uppercase tracking-widest">{label}</span>
  </button>
);

function HomeScreen({ songs, playlists, onPlay, currentSong, isPlaying, userData }: any) {
  return (
    <div className="space-y-12 py-8 animate-slide-up">
      <section>
        <div className="h-64 rounded-[3.5rem] overflow-hidden relative shadow-2xl group border border-white/10">
          <img src="https://images.unsplash.com/photo-1459749411177-042180ce673c?q=80&w=1000&auto=format&fit=crop" alt="" className="w-full h-full object-cover brightness-75 transition-transform duration-[4s] group-hover:scale-110" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0a] via-[#0a0a0a]/30 to-transparent flex flex-col justify-end p-10">
            <span className="bg-accent/20 backdrop-blur-xl border border-white/10 text-[9px] font-black px-4 py-1.5 rounded-full w-fit mb-4 tracking-[0.3em] uppercase">Hyperdrive Mix</span>
            <h3 className="text-4xl font-black italic leading-none tracking-tighter">Cosmic Frequencies</h3>
            <p className="text-white/40 text-[10px] mt-4 font-black uppercase tracking-[0.2em]">Synchronized for Voyager {userData?.name}</p>
          </div>
        </div>
      </section>

      {playlists.length > 0 && (
        <section>
          <div className="flex justify-between items-center mb-6 px-2">
            <h2 className="text-2xl font-black italic tracking-tighter">Cluster Access</h2>
          </div>
          <div className="flex gap-5 overflow-x-auto hide-scrollbar -mx-2 px-2">
            {playlists.map((p: Playlist) => (
               <div key={p.id} className="flex-shrink-0 w-40 space-y-3 group cursor-pointer active:scale-95 transition-all">
                  <div className="aspect-square glass rounded-[2.5rem] flex items-center justify-center border-accent/20 border-2 overflow-hidden shadow-xl group-hover:bg-white/5 transition-colors">
                     <span className="text-4xl">🛸</span>
                  </div>
                  <p className="text-xs font-black truncate px-1 uppercase tracking-tighter text-center">{p.name}</p>
               </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="flex justify-between items-center mb-8 px-2">
          <h2 className="text-2xl font-black italic tracking-tighter">Latest Transmissions</h2>
          <button className="text-[10px] font-black text-accent tracking-widest uppercase bg-accent/10 px-4 py-1.5 rounded-full shadow-sm">Scan All</button>
        </div>
        <div className="grid grid-cols-2 gap-6 pb-10">
          {songs.map((song: Song) => (
            <div key={song.id} onClick={() => onPlay(song)} className="space-y-4 group cursor-pointer active:scale-95 transition-all">
              <div className="relative aspect-square rounded-[3rem] overflow-hidden shadow-2xl border border-white/5">
                <img src={song.img} alt={song.title} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-1000" />
                {currentSong?.id === song.id && isPlaying && (
                   <div className="absolute inset-0 bg-accent/40 backdrop-blur-md flex items-center justify-center">
                      <div className="flex gap-2 items-end h-10 animate-bounce">
                        <div className="w-1.5 bg-white rounded-full h-4"></div>
                        <div className="w-1.5 bg-white rounded-full h-9"></div>
                        <div className="w-1.5 bg-white rounded-full h-5"></div>
                      </div>
                   </div>
                )}
              </div>
              <div className="px-2">
                <p className="text-sm font-black truncate leading-tight mb-1">{song.title}</p>
                <p className="text-[10px] text-white/30 uppercase font-black truncate tracking-widest">{song.artist}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function SearchScreen({ songs, onPlay, currentSong, isPlaying }: any) {
  const [queryText, setQueryText] = useState('');
  const shortcuts = ['Pulse', 'Synth', 'Deep Focus', 'Drift', 'Nebula', 'Echo'];
  
  const filtered = useMemo(() => 
    songs.filter((s: Song) => 
      s.title.toLowerCase().includes(queryText.toLowerCase()) || 
      s.artist.toLowerCase().includes(queryText.toLowerCase()) ||
      (s.album && s.album.toLowerCase().includes(queryText.toLowerCase()))
    ), 
    [queryText, songs]
  );

  return (
    <div className="py-8 space-y-10 animate-slide-up">
      <div className="relative group">
        <div className="absolute left-6 top-1/2 -translate-y-1/2 text-white/20 group-focus-within:text-accent transition-all">
          <SearchIcon size={24} />
        </div>
        <input 
          type="text" 
          placeholder="Scan Frequency..." 
          className="w-full py-6 pl-16 pr-6 bg-white/5 border border-white/10 rounded-[2.5rem] outline-none focus:border-accent focus:bg-white/10 transition-all font-black text-white placeholder:text-white/10 shadow-inner" 
          value={queryText} 
          onChange={(e) => setQueryText(e.target.value)} 
        />
      </div>

      <div className="flex gap-3 overflow-x-auto hide-scrollbar -mx-2 px-2">
         {shortcuts.map(s => (
           <button 
             key={s} 
             onClick={() => setQueryText(s)} 
             className={`flex-shrink-0 px-6 py-3 glass rounded-full text-[10px] font-black uppercase tracking-widest border transition-all active:scale-95 ${queryText === s ? 'border-accent text-accent bg-accent/10 shadow-lg shadow-accent/10' : 'border-white/5 hover:border-white/20'}`}
           >
             {s}
           </button>
         ))}
      </div>

      <div className="space-y-4 pb-20">
        {filtered.map((song: Song) => (
          <div key={song.id} onClick={() => onPlay(song)} className="flex items-center gap-5 p-4 glass rounded-[2.5rem] active:scale-95 transition-all border border-transparent hover:border-white/10 group cursor-pointer">
            <img src={song.img} alt="" className="w-16 h-16 rounded-[1.8rem] object-cover shadow-xl group-hover:scale-105 transition-transform" />
            <div className="flex-1 min-w-0">
               <p className="font-black text-base truncate mb-1">{song.title}</p>
               <p className="text-[10px] text-accent uppercase font-black truncate tracking-widest">{song.artist}</p>
            </div>
            <div className={`w-12 h-12 flex items-center justify-center rounded-full transition-all ${currentSong?.id === song.id && isPlaying ? 'bg-accent shadow-xl shadow-accent/20 scale-110' : 'glass'}`}>
               {currentSong?.id === song.id && isPlaying ? <PauseIcon size={20} /> : <PlayIcon size={20} fill="currentColor" />}
            </div>
          </div>
        ))}
        {queryText && filtered.length === 0 && (
          <div className="text-center py-20 opacity-20">
             <p className="text-xl font-black italic mb-2">No signal matches your scan.</p>
             <button onClick={() => setQueryText('')} className="text-[10px] font-black uppercase tracking-widest text-accent underline">Reset Frequency</button>
          </div>
        )}
      </div>
    </div>
  );
}

function LibraryScreen({ songs, playlists, onPlay, userData, onCreatePlaylist }: any) {
  const [offlineSongs, setOfflineSongs] = useState<any[]>([]);
  useEffect(() => { getAllOfflineSongs().then(setOfflineSongs); }, []);
  const liked = useMemo(() => songs.filter((s: Song) => userData?.likedSongs?.includes(s.id)), [songs, userData]);

  return (
    <div className="py-8 space-y-12 animate-slide-up">
      <div className="flex justify-between items-end px-2">
        <h2 className="text-4xl font-black italic tracking-tighter">Frequency Vault</h2>
        <button onClick={onCreatePlaylist} className="w-14 h-14 flex items-center justify-center bg-accent text-white rounded-[1.8rem] shadow-xl shadow-accent/20 active:scale-90 transition-transform"><svg width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 4v16m8-8H4" strokeLinecap="round" strokeLinejoin="round"/></svg></button>
      </div>
      
      <div className="grid grid-cols-2 gap-6">
        <div className="bg-gradient-to-br from-red-500 to-pink-700 aspect-square rounded-[3.5rem] p-8 flex flex-col justify-end shadow-2xl shadow-red-900/20 active:scale-95 transition-transform border border-white/10 relative group overflow-hidden">
           <div className="absolute -top-4 -right-4 text-8xl opacity-10 rotate-12 group-hover:scale-125 transition-transform duration-1000">❤️</div>
           <p className="font-black text-2xl leading-none italic relative z-10">Synced</p>
           <p className="text-[9px] font-black uppercase opacity-60 mt-3 tracking-widest relative z-10">{liked.length} Signals</p>
        </div>
        <div className="bg-gradient-to-br from-accent to-indigo-700 aspect-square rounded-[3.5rem] p-8 flex flex-col justify-end shadow-2xl shadow-accent/20 active:scale-95 transition-transform border border-white/10 relative group overflow-hidden">
           <div className="absolute -top-4 -right-4 text-8xl opacity-10 rotate-12 group-hover:scale-125 transition-transform duration-1000">📦</div>
           <p className="font-black text-2xl leading-none italic relative z-10">Vaulted</p>
           <p className="text-[9px] font-black uppercase opacity-60 mt-3 tracking-widest relative z-10">{offlineSongs.length} Offline</p>
        </div>
      </div>

      <section>
        <h3 className="text-[10px] font-black text-white/30 uppercase tracking-[0.4em] mb-8 px-2">Established Clusters</h3>
        {playlists.length === 0 ? (
          <div className="py-16 text-center glass rounded-[3rem] border-dashed border-white/10 opacity-30 flex flex-col items-center">
             <LibraryIcon size={40} className="mb-4" />
             <p className="text-xs font-black uppercase tracking-widest">No clusters established</p>
          </div>
        ) : (
          <div className="space-y-4">
             {playlists.map((p: Playlist) => (
                <div key={p.id} className="p-6 glass rounded-[2.5rem] border border-white/5 flex items-center justify-between active:bg-white/5 transition-colors group cursor-pointer">
                   <div className="flex-1 min-w-0 pr-4">
                      <p className="font-black text-lg italic tracking-tight uppercase leading-none mb-1.5 truncate">{p.name}</p>
                      <p className="text-[9px] font-black text-white/20 uppercase tracking-widest">{p.songIds.length} Signals • {p.isPublic ? 'Broadcasting' : 'Private'}</p>
                   </div>
                   <div className="w-12 h-12 flex items-center justify-center glass rounded-2xl group-hover:bg-accent group-hover:text-white transition-all"><PlayIcon size={18} /></div>
                </div>
             ))}
          </div>
        )}
      </section>

      <section className="pb-20">
        <h3 className="text-[10px] font-black text-white/30 uppercase tracking-[0.4em] mb-8 px-2">Offline Node Status</h3>
        <div className="space-y-4">
           {offlineSongs.map(s => (
             <div key={s.id} onClick={() => onPlay(s)} className="flex items-center gap-5 p-5 glass rounded-[2.5rem] active:bg-white/10 border border-white/5 transition-all group">
                <img src={s.img} alt="" className="w-16 h-16 rounded-[1.8rem] object-cover shadow-lg group-hover:scale-105 transition-transform" />
                <div className="flex-1 min-w-0">
                  <p className="font-black text-base truncate leading-none mb-1.5 uppercase tracking-tight">{s.title}</p>
                  <p className="text-[10px] text-white/30 uppercase font-black truncate tracking-widest">{s.artist}</p>
                </div>
                <div className="text-green-500 bg-green-500/10 p-4 rounded-full border border-green-500/10 shadow-lg"><svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg></div>
             </div>
           ))}
        </div>
      </section>
    </div>
  );
}

function ProfileScreen({ userData, onToast }: any) {
  const [promo, setPromo] = useState('');
  const themes = ['default', 'midnight', 'sunset', 'ocean', 'forest'];

  const applyPromo = async () => {
    // Robust promo system: MUSICO2025, VIPACCESS, UNIVERSE
    const validCodes = ['MUSICO2025', 'VIPACCESS', 'UNIVERSE'];
    if (validCodes.includes(promo.toUpperCase())) {
      await updateDoc(doc(db, 'users', userData.uid), { isPremium: true });
      onToast("Elite Access Frequency Unlocked! ✨");
      setPromo('');
    } else {
      onToast("Invalid Code Pattern.");
    }
  };

  const changeTheme = async (t: string) => {
    await updateDoc(doc(db, 'users', userData.uid), { theme: t });
    onToast(`Theme set to ${t.toUpperCase()} spectrum`);
  };

  return (
    <div className="py-8 space-y-12 animate-slide-up pb-20">
      <div className="flex items-center justify-between mb-12 px-2">
        <h2 className="text-4xl font-black italic tracking-tighter">My Identity</h2>
        <button onClick={() => signOut(auth)} className="w-14 h-14 flex items-center justify-center glass rounded-[1.8rem] text-red-500 border border-red-500/20 active:bg-red-500/10 transition-all"><svg width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" strokeLinecap="round" strokeLinejoin="round"/></svg></button>
      </div>

      <div className="flex flex-col items-center">
         <div className="relative p-1.5 rounded-full bg-gradient-to-tr from-accent to-white/20 shadow-2xl mb-8 group">
           <img src={userData?.img || `https://ui-avatars.com/api/?name=${userData?.name}&background=0a0a0a&color=fff&size=256`} className="w-40 h-40 rounded-full border-[8px] border-[#0a0a0a] object-cover group-hover:scale-105 transition-transform duration-500 shadow-inner" alt="" />
           {userData?.isPremium && (
             <div className="absolute -bottom-1 -right-1 bg-yellow-500 text-black px-4 py-1.5 rounded-2xl text-[10px] font-black italic shadow-2xl border-4 border-[#0a0a0a] animate-bounce">ELITE</div>
           )}
         </div>
         <h3 className="text-3xl font-black tracking-tighter italic leading-none">{userData?.name || 'Voyager'}</h3>
         <p className="text-white/20 font-black uppercase tracking-[0.4em] text-[9px] mt-4 leading-none">{userData?.email}</p>
      </div>

      <section className="space-y-8 px-2">
        <h4 className="text-[10px] font-black text-white/30 uppercase tracking-[0.4em] mb-4">Spectrum Themes</h4>
        <div className="flex gap-5 overflow-x-auto hide-scrollbar pb-4">
           {themes.map(t => (
             <button 
               key={t} 
               onClick={() => changeTheme(t)} 
               className={`flex-shrink-0 w-20 h-20 rounded-[2.5rem] border-4 transition-all active:scale-90 shadow-lg ${userData?.theme === t ? 'border-white scale-110 shadow-accent/40' : 'border-white/5 opacity-60 hover:opacity-100'}`} 
               style={{ backgroundColor: t === 'default' ? '#a855f7' : t === 'midnight' ? '#3b82f6' : t === 'sunset' ? '#f97316' : t === 'ocean' ? '#14b8a6' : '#22c55e' }}
             >
                {userData?.theme === t && <div className="w-2 h-2 bg-white rounded-full mx-auto" />}
             </button>
           ))}
        </div>
      </section>

      {!userData?.isPremium && (
        <section className="bg-white/5 rounded-[3.5rem] p-10 border border-white/10 space-y-8 shadow-2xl relative overflow-hidden group">
           <div className="absolute -top-10 -right-10 w-40 h-40 bg-accent/5 blur-[80px] group-hover:bg-accent/10 transition-all"></div>
           <h4 className="text-[10px] font-black text-accent uppercase tracking-[0.4em] leading-none">Upgrade Protocol</h4>
           <div className="flex gap-4">
              <input 
                type="text" 
                placeholder="PROMO CODE..." 
                className="flex-1 glass rounded-2xl px-6 py-5 outline-none font-black text-sm text-white placeholder:text-white/10 uppercase border border-white/5 focus:border-accent transition-all" 
                value={promo} 
                onChange={(e) => setPromo(e.target.value)} 
              />
              <button onClick={applyPromo} className="bg-accent text-white font-black px-10 rounded-2xl uppercase text-[10px] tracking-widest shadow-xl shadow-accent/20 active:scale-95 transition-all">Link</button>
           </div>
           <p className="text-[9px] text-white/20 font-medium italic">Available Codes: VIPACCESS, UNIVERSE</p>
        </section>
      )}

      <div className="grid grid-cols-1 gap-6 px-2">
         <div className="p-8 glass rounded-[3rem] border border-white/5 flex items-center justify-between group cursor-pointer hover:bg-white/5 transition-colors">
            <div>
              <p className="text-[9px] font-black text-white/30 uppercase tracking-widest mb-2">Broadcasting Status</p>
              <p className="text-xl font-black italic tracking-tight">{userData?.isPrivate ? 'Stealth Node' : 'Public Signal'}</p>
            </div>
            <button 
              onClick={() => updateDoc(doc(db, 'users', userData.uid), { isPrivate: !userData.isPrivate })} 
              className={`w-16 h-8 rounded-full transition-all relative ${userData?.isPrivate ? 'bg-white/10' : 'bg-accent'}`}
            >
               <div className={`absolute top-1 w-6 h-6 bg-white rounded-full transition-all shadow-md ${userData?.isPrivate ? 'left-1' : 'right-1'}`} />
            </button>
         </div>
         <div className="p-8 glass rounded-[3rem] border border-white/5 flex items-center justify-between group">
            <div>
              <p className="text-[9px] font-black text-white/30 uppercase tracking-widest mb-2">Cosmic Assets</p>
              <p className="text-3xl font-black italic text-yellow-500 tracking-tighter">{userData?.coins || 0} <span className="text-sm font-black uppercase tracking-widest opacity-40 ml-1">Coins</span></p>
            </div>
            <div className="text-4xl">🪙</div>
         </div>
      </div>
    </div>
  );
}

// MODAL SUB-COMPONENTS

function PlaylistModal({ onClose, onToast }: any) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [isPublic, setIsPublic] = useState(true);

  const create = async () => {
    if (!name) { onToast("Name required!"); return; }
    try {
      const playlist: Partial<Playlist> = { 
        name, 
        description: desc, 
        isPublic, 
        ownerId: auth.currentUser?.uid, 
        ownerName: auth.currentUser?.displayName || 'Voyager', 
        songIds: [], 
        createdAt: Date.now() 
      };
      await addDoc(collection(db, 'playlists'), playlist);
      onToast("Cluster established! 🛸");
      onClose();
    } catch (e) { onToast("Establishing failed."); }
  };

  return (
    <div className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-xl flex items-end p-4 animate-slide-up">
      <div className="w-full glass rounded-[4rem] p-12 border border-white/10 shadow-[0_-20px_100px_rgba(0,0,0,0.8)] pb-16">
        <div className="flex justify-between items-center mb-10">
           <h3 className="text-3xl font-black italic tracking-tighter">Create Cluster</h3>
           <button onClick={onClose} className="w-12 h-12 flex items-center justify-center bg-white/5 rounded-full hover:bg-white/10 transition-colors">✕</button>
        </div>
        <div className="space-y-6">
           <input 
             type="text" 
             placeholder="Cluster Name..." 
             className="w-full bg-white/5 rounded-3xl p-6 font-black text-sm outline-none border border-white/5 focus:border-accent transition-all" 
             value={name} 
             onChange={e => setName(e.target.value)} 
           />
           <textarea 
             placeholder="Cluster Data Description..." 
             className="w-full bg-white/5 rounded-3xl p-6 font-black text-sm outline-none border border-white/5 focus:border-accent h-32 resize-none transition-all" 
             value={desc} 
             onChange={e => setDesc(e.target.value)} 
           />
           <div className="flex items-center justify-between p-6 glass rounded-3xl border border-white/5">
              <p className="text-xs font-black uppercase tracking-[0.3em] text-white/40">{isPublic ? 'Public Broadcast' : 'Hidden frequency'}</p>
              <button 
                onClick={() => setIsPublic(!isPublic)} 
                className={`w-16 h-8 rounded-full transition-all relative ${isPublic ? 'bg-accent' : 'bg-white/10'}`}
              >
                <div className={`absolute top-1 w-6 h-6 bg-white rounded-full transition-all shadow-md ${isPublic ? 'right-1' : 'left-1'}`} />
              </button>
           </div>
           <button onClick={create} className="w-full py-6 bg-accent text-white rounded-[2.5rem] font-black tracking-[0.2em] uppercase shadow-2xl shadow-accent/30 active:scale-95 transition-all mt-4 border border-white/10">Initialize Cluster</button>
        </div>
      </div>
    </div>
  );
}

function AddToPlaylistModal({ song, playlists, onClose, onToast }: any) {
  const add = async (pId: string) => {
    try {
      const pRef = doc(db, 'playlists', pId);
      const snap = await getDoc(pRef);
      if (snap.exists() && (snap.data() as Playlist).songIds.includes(song.id)) {
        onToast("Signal already synced.");
        onClose();
        return;
      }
      await updateDoc(pRef, { songIds: arrayUnion(song.id) });
      onToast(`Signal synced to cluster! 🛸`);
      onClose();
    } catch(e) { onToast("Sync failure."); }
  };

  return (
    <div className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-xl flex items-end p-4 animate-slide-up">
       <div className="w-full glass rounded-[4rem] p-12 border border-white/10 max-h-[75vh] flex flex-col pb-16">
          <div className="flex justify-between items-center mb-10">
            <h3 className="text-3xl font-black italic tracking-tighter">Sync to Cluster</h3>
            <button onClick={onClose} className="w-12 h-12 flex items-center justify-center bg-white/5 rounded-full hover:bg-white/10 transition-colors">✕</button>
          </div>
          <div className="flex-1 overflow-y-auto hide-scrollbar space-y-4 pr-2">
             {playlists.map((p: Playlist) => (
                <div key={p.id} onClick={() => add(p.id)} className="p-6 glass rounded-[2.5rem] border border-white/5 flex items-center justify-between active:scale-95 active:bg-accent/10 transition-all group cursor-pointer hover:border-accent/20">
                   <div className="flex-1 truncate pr-4">
                      <p className="font-black italic text-xl uppercase leading-none mb-1 group-hover:text-accent transition-colors">{p.name}</p>
                      <p className="text-[10px] font-black opacity-30 uppercase tracking-widest">{p.songIds.length} Signals Locked</p>
                   </div>
                   <div className="w-10 h-10 flex items-center justify-center glass rounded-xl"><PlayIcon size={16} /></div>
                </div>
             ))}
             {playlists.length === 0 && (
                <div className="py-24 text-center opacity-20 flex flex-col items-center">
                  <LibraryIcon size={48} className="mb-4" />
                  <p className="text-lg font-black italic">No established clusters found.</p>
                </div>
             )}
          </div>
       </div>
    </div>
  );
}

function DedicateModal({ song, userData, onClose, onSend }: any) {
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
    <div className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-xl flex items-end p-4 animate-slide-up">
      <div className="w-full glass rounded-[4rem] p-12 border border-white/10 pb-16 shadow-2xl">
        <div className="flex justify-between items-center mb-10">
          <h3 className="text-3xl font-black italic tracking-tighter">Dedicate Signal</h3>
          <button onClick={onClose} className="w-12 h-12 flex items-center justify-center bg-white/5 rounded-full active:scale-90 transition-all">✕</button>
        </div>
        <p className="text-[10px] text-white/30 uppercase font-black mb-8 tracking-[0.4em] px-2">Select Target Ally (Cost: 5 🪙)</p>
        <div className="flex gap-6 overflow-x-auto hide-scrollbar mb-10 py-4 -mx-2 px-2">
          {friends.map(f => (
            <button key={f.uid} onClick={() => setSelectedFriend(f.uid)} className={`flex-shrink-0 flex flex-col items-center gap-4 transition-all ${selectedFriend === f.uid ? 'scale-110 opacity-100' : 'opacity-30'}`}>
              <div className={`w-20 h-20 rounded-full p-1.5 border-4 shadow-xl transition-all ${selectedFriend === f.uid ? 'border-accent shadow-accent/20' : 'border-transparent'}`}>
                <img src={f.img || `https://ui-avatars.com/api/?name=${f.name}&background=6366f1&color=fff`} className="w-full h-full rounded-full object-cover" />
              </div>
              <span className="text-[10px] font-black truncate max-w-[80px] uppercase tracking-tighter">{f.name.split(' ')[0]}</span>
            </button>
          ))}
          {friends.length === 0 && !loading && <p className="text-sm text-white/20 italic p-6 text-center w-full">Network scanning returned 0 allies.</p>}
        </div>
        <textarea 
          placeholder="Transmit a message across space..." 
          className="w-full bg-white/5 rounded-[2rem] p-8 text-sm font-semibold outline-none border border-white/5 focus:border-accent h-32 resize-none mb-10 transition-all placeholder:text-white/10" 
          value={message} 
          onChange={(e) => setMessage(e.target.value)} 
        />
        <button 
          disabled={!selectedFriend} 
          onClick={() => onSend(selectedFriend, message)} 
          className="w-full py-6 bg-accent text-white rounded-[2.5rem] font-black tracking-[0.2em] uppercase shadow-2xl shadow-accent/30 disabled:opacity-20 active:scale-95 transition-all border border-white/10"
        >
          Initialize Transmission
        </button>
      </div>
    </div>
  );
}

function AuthScreen({ onToast }: any) {
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
          theme: 'default',
          friends: [], 
          likedSongs: [], 
          coinHistory: [{ id: 'genesis', type: 'earn', amount: 20, description: 'Galaxy Manifested', timestamp: Date.now() }]
        };
        await setDoc(doc(db, 'users', cred.user.uid), newUser);
        onToast("Galaxy Manifested! Welcome Voyager. 🌌");
      }
    } catch (err: any) { 
       onToast(err.message);
    } finally { 
      setLoading(false); 
    }
  };

  return (
    <div className="h-screen bg-[#0a0a0a] p-10 flex flex-col justify-center animate-slide-up relative overflow-hidden">
      <div className="absolute inset-0 bg-accent/5 blur-[150px] rounded-full scale-150 -translate-y-1/2"></div>
      <div className="mb-16 text-center relative z-10">
        <h1 className="text-7xl font-black text-accent tracking-tighter mb-4 italic shadow-accent/10">MUSICO</h1>
        <p className="text-white/20 font-black uppercase tracking-[0.4em] text-[10px]">The Social Music Singularity v3.5</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-5 max-w-sm w-full mx-auto relative z-10">
        {!isLogin && (
          <input 
            type="text" 
            placeholder="IDENTITY HANDLE" 
            required 
            className="w-full p-6 bg-white/5 border border-white/10 rounded-2xl outline-none focus:border-accent text-white font-black tracking-widest placeholder:text-white/10" 
            value={name} 
            onChange={(e) => setName(e.target.value)} 
          />
        )}
        <input 
          type="email" 
          placeholder="COMMS ADDRESS" 
          required 
          className="w-full p-6 bg-white/5 border border-white/10 rounded-2xl outline-none focus:border-accent text-white font-black tracking-widest placeholder:text-white/10" 
          value={email} 
          onChange={(e) => setEmail(e.target.value)} 
        />
        <input 
          type="password" 
          placeholder="ACCESS KEY" 
          required 
          className="w-full p-6 bg-white/5 border border-white/10 rounded-2xl outline-none focus:border-accent text-white font-black tracking-widest placeholder:text-white/10" 
          value={password} 
          onChange={(e) => setPassword(e.target.value)} 
        />
        <button 
          disabled={loading} 
          className="w-full py-6 bg-accent rounded-3xl font-black text-lg shadow-2xl shadow-accent/20 active:scale-95 transition-all disabled:opacity-50 mt-10 text-white uppercase tracking-[0.3em] border border-white/10"
        >
          {loading ? 'SYNCHRONIZING...' : (isLogin ? 'OPEN SESSION' : 'MANIFEST IDENTITY')}
        </button>
      </form>
      <p className="mt-14 text-center text-white/20 font-black text-[10px] uppercase tracking-widest relative z-10">
        {isLogin ? "UNMANIFESTED VOYAGER?" : "ESTABLISHED FREQUENCY?"}{' '}
        <span onClick={() => setIsLogin(!isLogin)} className="text-accent cursor-pointer ml-2 hover:underline decoration-accent/40">{isLogin ? 'ESTABLISH LINK' : 'RESYNC SESSION'}</span>
      </p>
    </div>
  );
}
