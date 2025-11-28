import { useEffect, useState } from "react";
import { auth } from "../firebase";
import {
    onAuthStateChanged,
    signOut,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
} from "firebase/auth";
import { db } from "../firebase";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";

export type AppUser = {
    uid: string;
    email: string;
    role: "student" | "teacher" | "admin";
    term?: number | null;
    termLabel?: string | null;
    semesterStatus?: string | null;
    displayName?: string | null;
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

            try {
                const ref = doc(db, "users", fbUser.uid);
                let snap = await getDoc(ref);

                if (!snap.exists()) {
                    // Første gang: lag bruker i Firestore som standard student
                    const newUser: AppUser = {
                        uid: fbUser.uid,
                        email: fbUser.email ?? "",
                        displayName: fbUser.displayName ?? fbUser.email ?? "",
                        role: "student",
                        term: null,
                        termLabel: null,
                        semesterStatus: "aktiv",
                    };

                    await setDoc(ref, {
                        ...newUser,
                        createdAt: serverTimestamp(),
                    });

                    setUser(newUser);
                    setLoading(false);
                    return;
                }

                const data = snap.data() as any;

                const appUser: AppUser = {
                    uid: fbUser.uid,
                    email: data?.email ?? fbUser.email ?? "",
                    role: (data?.role as any) ?? "student",
                    term: data?.term ?? null,
                    termLabel: data?.termLabel ?? null,
                    semesterStatus: data?.semesterStatus ?? null,
                    displayName:
                        data?.name ??
                        data?.displayName ??
                        fbUser.displayName ??
                        fbUser.email ??
                        "",
                };

                setUser(appUser);
            } catch (err) {
                console.error("Feil ved henting/oppretting av bruker:", err);
                setUser(null);
            } finally {
                setLoading(false);
            }
        });

        return () => unsub();
    }, []);

    const login = async (email: string, password: string) => {
        await signInWithEmailAndPassword(auth, email, password);
    };

    const register = async (email: string, password: string) => {
        await createUserWithEmailAndPassword(auth, email, password);
        // onAuthStateChanged lager Firestore-bruker første gang
    };

    const logout = async () => {
        await signOut(auth);
    };

    return { user, loading, login, register, logout };
}