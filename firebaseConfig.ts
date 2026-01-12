
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Replace with your actual config from the prompt
const firebaseConfig = {
  apiKey: "AIzaSyCHjaO7DOBSXFlp1tT4U5tJ__V8la1ervU",
  authDomain: "musico-6b04c.firebaseapp.com",
  databaseURL: "https://musico-6b04c-default-rtdb.firebaseio.com",
  projectId: "musico-6b04c",
  storageBucket: "musico-6b04c.firebasestorage.app",
  messagingSenderId: "890007852096",
  appId: "1:890007852096:web:e4157b6527baefee993ba5",
  measurementId: "G-DXHFND427V"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
