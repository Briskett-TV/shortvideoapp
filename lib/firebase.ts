import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyC3XsOieJ_cScHiIY6fr3aKW9h7zuH7NRk",
  authDomain: "shortvideoapp-d5366.firebaseapp.com",
  projectId: "shortvideoapp-d5366",
  storageBucket: "shortvideoapp-d5366.firebasestorage.app",
  messagingSenderId: "254687124598",
  appId: "1:254687124598:web:fd35d3e9f8cc062d925357",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);