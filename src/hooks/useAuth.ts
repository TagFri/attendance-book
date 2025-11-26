import { useEffect, useState } from "react";
import { auth } from "../firebase";
import {
    onAuthStateChanged,
    signOut,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
} from "firebase/auth";
import { db } from "../firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";

export type AppUser = {
    uid: string;
    email: string | null;
    displayName: string | null;
    role: "student" | "teacher" | "admin";
    term: number | null;
    semesterStatus?: string;
};

export function useAuth() {
    const [user, setUser] = useState<AppUser | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, async (fbUser) => {
            if (!fbUser) {
                setUser(null);
                setLoading(false);
                return;
            }

            const ref = doc(db, "users", fbUser.uid);
            const snap = await getDoc(ref);

            if (snap.exists()) {
                const data = snap.data() as any;
                const appUser: AppUser = {
                    uid: fbUser.uid,
                    email: fbUser.email,
                    displayName: fbUser.displayName ?? fbUser.email,
                    role: data.role ?? "student",
                    term: data.term ?? null,
                    semesterStatus: data.semesterStatus ?? "aktiv",
                };
                setUser(appUser);
            } else {
                // Første gang: lag bruker i Firestore
                const newUser: AppUser = {
                    uid: fbUser.uid,
                    email: fbUser.email,
                    displayName: fbUser.email,
                    role: "student",
                    term: null,
                    semesterStatus: "aktiv",
                };
                await setDoc(ref, newUser);
                setUser(newUser);
            }

            setLoading(false);
        });

        return () => unsub();
    }, []);

    const login = async (email: string, password: string) => {
        await signInWithEmailAndPassword(auth, email, password);
    };

    const register = async (email: string, password: string) => {
        await createUserWithEmailAndPassword(auth, email, password);
        // onAuthStateChanged vil fyre etterpå og lage Firestore-bruker
    };

    const logout = async () => {
        await signOut(auth);
    };

    return { user, loading, login, register, logout };
}