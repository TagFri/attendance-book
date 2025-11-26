import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// BYTT UT MED DIN CONFIG FRA FIREBASE CONSOLE
const firebaseConfig = {
    apiKey: "AIzaSyARwb6K0M4l-hWKi8FrOLEVqRqeHRf8JR4",
    authDomain: "oppmoteboka.firebaseapp.com",
    projectId: "oppmoteboka",
    storageBucket: "oppmoteboka.firebasestorage.app",
    messagingSenderId: "732911922070",
    appId: "1:732911922070:web:b16d9de65062395c018bb7"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);