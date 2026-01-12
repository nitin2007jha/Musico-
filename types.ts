
export interface Song {
  id: string;
  title: string;
  artist: string;
  album?: string;
  img: string;
  url: string;
}

export interface CoinTransaction {
  id: string;
  type: 'earn' | 'spend';
  amount: number;
  description: string;
  timestamp: number;
}

export interface UserData {
  uid: string;
  name: string;
  email: string;
  img?: string;
  isPrivate: boolean;
  coins: number;
  isPremium: boolean;
  friends: string[]; 
  likedSongs: string[];
  coinHistory: CoinTransaction[];
}

export interface Dedication {
  id: string;
  fromUid: string;
  fromName: string;
  toUid: string;
  songId: string;
  songTitle: string;
  message: string;
  timestamp: number;
}
