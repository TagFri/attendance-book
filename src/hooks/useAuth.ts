import { useEffect, useState } from "react";
import { auth } from "../firebase";
import {
    onAuthStateChanged,
    signOut,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
} from "firebase/auth";
import { db } from "../firebase";
import { doc, getDoc, setDoc, serverTimestamp, updateDoc, onSnapshot } from "firebase/firestore";

export type AppUser = {
    uid: string;
    email: string;
    role: "student" | "teacher" | "admin";
    term?: number | null;
    termLabel?: string | null;
    semesterStatus?: string | null;
    displayName?: string | null;
    approvedCurrentTerm?: boolean | null;
};

export function useAuth() {
    const [user, setUser] = useState<AppUser | null>(null);
    const [loading, setLoading] = useState(true);

    // Generer base64url-random (16 byte)
    const genAuthUid = (): string => {
        try {
            const bytes = new Uint8Array(16);
            crypto.getRandomValues(bytes);
            let s = Array.from(bytes)
                .map((b) => String.fromCharCode(b))
                .join("");
            // @ts-ignore
            s = btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
            return s;
        } catch {
            return (
                Math.random().toString(36).slice(2) +
                Math.random().toString(36).slice(2)
            );
        }
    };

    useEffect(() => {
        let unsubUserDoc: (() => void) | null = null;
        const unsubAuth = onAuthStateChanged(auth, async (fbUser) => {
            // Rydd opp tidligere doc-lytter når auth endres
            if (unsubUserDoc) {
                unsubUserDoc();
                unsubUserDoc = null;
            }

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
                    const newUserData = {
                        uid: fbUser.uid,
                        email: fbUser.email ?? "",
                        displayName: fbUser.displayName ?? fbUser.email ?? "",
                        role: "student" as const,
                        term: null as number | null,
                        termLabel: null as string | null,
                        semesterStatus: "aktiv" as string | null,
                        approvedCurrentTerm: false,
                        createdAt: serverTimestamp(),
                        authUid: genAuthUid(),
                    };
                    await setDoc(ref, newUserData);
                    // Ikke returner – sett opp snapshot under, så vi følger endringer i sanntid
                } else {
                    const data = snap.data() as any;
                    // Sync e‑post hvis den har endret seg i Auth
                    if (fbUser.email && data?.email !== fbUser.email) {
                        try {
                            await updateDoc(ref, { email: fbUser.email });
                        } catch (e) {
                            console.warn("Kunne ikke synkronisere e‑post til Firestore:", e);
                        }
                    }
                    // Sørg for authUid for eksisterende kontoer
                    if (!data?.authUid) {
                        try {
                            await updateDoc(ref, { authUid: genAuthUid() });
                        } catch (e) {
                            console.warn("Kunne ikke sette authUid på bruker.", e);
                        }
                    }
                }

                // Lytt i sanntid på bruker-dokumentet for å få oppdateringer (f.eks. approvedCurrentTerm)
                unsubUserDoc = onSnapshot(
                    ref,
                    (docSnap) => {
                        const data = docSnap.data() as any;
                        if (!data) return;
                        const appUser: AppUser = {
                            uid: fbUser.uid,
                            email: (data?.email as string) ?? fbUser.email ?? "",
                            role: (data?.role as any) ?? "student",
                            term: data?.term ?? null,
                            termLabel: data?.termLabel ?? null,
                            semesterStatus: data?.semesterStatus ?? null,
                            approvedCurrentTerm:
                                typeof data?.approvedCurrentTerm === "boolean"
                                    ? data.approvedCurrentTerm
                                    : false,
                            displayName:
                                data?.name ??
                                data?.displayName ??
                                fbUser.displayName ??
                                fbUser.email ??
                                "",
                        };
                        setUser(appUser);
                        setLoading(false);
                    },
                    (err) => {
                        console.error("Feil ved realtime-lytting på bruker:", err);
                        setLoading(false);
                    }
                );
            } catch (err) {
                console.error("Feil ved henting/oppretting av bruker:", err);
                setUser(null);
                setLoading(false);
            }
        });

        return () => {
            if (unsubUserDoc) unsubUserDoc();
            unsubAuth();
        };
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