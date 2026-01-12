
export interface Song {
  id: string;
  title: string;
  artist: string;
  album?: string;
  img: string;
  url: string;
}

export interface Playlist {
  id: string;
  name: string;
  isPublic: boolean;
  ownerId: string;
  songs: string[]; // IDs
}

export interface UserData {
  uid: string;
  name: string;
  email: string;
  img?: string;
  isPrivate: boolean;
  coins: number;
  isPremium: boolean;
  friends: string[]; // UIDs
  friendRequests: string[]; // UIDs
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
