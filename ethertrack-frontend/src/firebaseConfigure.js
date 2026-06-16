import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, FacebookAuthProvider } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyD19ag4jlslGH_YrmczkMFX_WrXn95dGvc",
  authDomain: "ethertrack-d9d02.firebaseapp.com",  // Correct project ID
  projectId: "ethertrack-d9d02",  
  storageBucket: "ethertrack-d9d02.appspot.com",  // Correct storage bucket
  messagingSenderId: "312361710283",  // Use your actual Firebase Messaging Sender ID
  appId: "1:312361710283:web:de99711a69d589e21ce14e"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();
const facebookProvider = new FacebookAuthProvider();

export { auth, googleProvider, facebookProvider };
