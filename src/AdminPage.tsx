import { useEffect, useMemo, useState } from "react";
import type { AppUser } from "./hooks/useAuth";
import { db } from "./firebase";
import {
    collection,
    getDocs,
    updateDoc,
    addDoc,
    doc,
    query,
    where,
    deleteDoc,
} from "firebase/firestore";
import TeacherPage from "./TeacherPage";

/* ---------- Typer ---------- */

type AdminPageProps = {
    user: AppUser;
};

type UserRow = AppUser & { docId: string };

type Category = {
    id: string;
    name: string;
};

type Activity = {
    id: string;
    name: string;
    categoryId: string;
};

type Requirement = {
    id: string;
    term: number;
    categoryId: string;
    requiredCount: number;
};

/* ---------- Hovedkomponent ---------- */

function AdminPage({ user }: AdminPageProps) {
    const [tab, setTab] = useState<"users" | "termSetup" | "teacher">("termSetup");

    return (
        <div style={{ maxWidth: "900px", margin: "0 auto" }}>
            <h2 style={{ textAlign: "center", marginBottom: "1rem" }}>
                Admin-panel
            </h2>
            <nav
                style={{
                    display: "flex",
                    justifyContent: "center",
                    gap: "0.5rem",
                    marginBottom: "1rem",
                    flexWrap: "wrap",
                }}
            >
                <TabButton active={tab === "termSetup"} onClick={() => setTab("termSetup")}>
                    Oppsett per termin
                </TabButton>
                <TabButton active={tab === "users"} onClick={() => setTab("users")}>
                    Brukere
                </TabButton>
                <TabButton active={tab === "teacher"} onClick={() => setTab("teacher")}>
                    Lærer-visning
                </TabButton>
            </nav>

            {tab === "termSetup" && <TermSetup />}
            {tab === "users" && <UsersAdmin />}
            {tab === "teacher" && <TeacherPage user={user} />}
        </div>
    );
}

function TabButton({
                       active,
                       onClick,
                       children,
                   }: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            onClick={onClick}
            style={{
                padding: "0.3rem 0.7rem",
                borderRadius: "999px",
                border: active ? "2px solid #2563eb" : "1px solid #ccc",
                background: active ? "#eff6ff" : "#f9fafb",
                cursor: "pointer",
            }}
        >
            {children}
        </button>
    );
}

/* ---------- Oppsett per termin: grupper + timer + krav ---------- */

function TermSetup() {
    const [selectedTerm, setSelectedTerm] = useState<number>(11);
    const [times, setTimes] = useState<TimeDoc[]>([]);
    const [requirements, setRequirements] = useState<RequirementDoc[]>([]);
    const [loading, setLoading] = useState(true);

    const [newReqCategory, setNewReqCategory] = useState("");
    // En input per kategori for å legge til timer
    const [newTimeNames, setNewTimeNames] = useState<Record<string, string>>({});

    const termOptions = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

    useEffect(() => {
        const load = async () => {
            setLoading(true);
            const [timesSnap, reqSnap] = await Promise.all([
                getDocs(collection(db, "times")),
                getDocs(collection(db, "requirements")),
            ]);

            const timesList: TimeDoc[] = timesSnap.docs.map((d) => {
                const data = d.data() as any;
                return {
                    id: d.id,
                    name: data.name,
                    category: data.category,
                    term: data.term,
                };
            });

            const reqList: RequirementDoc[] = reqSnap.docs.map((d) => {
                const data = d.data() as any;
                return {
                    id: d.id,
                    term: data.term,
                    category: data.category,
                    requiredCount: data.requiredCount,
                };
            });

            setTimes(timesList);
            setRequirements(reqList);
            setLoading(false);
        };

        load();
    }, []);

    const requirementsForTerm = requirements.filter(
        (r) => r.term === selectedTerm
    );
    const timesForTerm = times.filter((t) => t.term === selectedTerm);

    const handleChangeRequired = async (reqId: string, value: number) => {
        if (Number.isNaN(value) || value < 0) return;
        const ref = doc(db, "requirements", reqId);
        await updateDoc(ref, { requiredCount: value });
        setRequirements((prev) =>
            prev.map((r) =>
                r.id === reqId ? { ...r, requiredCount: value } : r
            )
        );
    };

    const handleDeleteRequirement = async (reqId: string) => {
        await deleteDoc(doc(db, "requirements", reqId));
        setRequirements((prev) => prev.filter((r) => r.id !== reqId));
        // Vi lar times stå igjen for historikk – de vil ikke vises lenger i admin
    };

    const handleAddRequirement = async (e: React.FormEvent) => {
        e.preventDefault();
        const category = newReqCategory.trim();
        if (!category) return;

        const exists = requirementsForTerm.find(
            (r) => r.category.toLowerCase() === category.toLowerCase()
        );
        if (exists) {
            setNewReqCategory("");
            return;
        }

        const colRef = collection(db, "requirements");
        const docRef = await addDoc(colRef, {
            term: selectedTerm,
            category,
            requiredCount: 0,
        });

        const newReq: RequirementDoc = {
            id: docRef.id,
            term: selectedTerm,
            category,
            requiredCount: 0,
        };
        setRequirements((prev) => [...prev, newReq]);
        setNewReqCategory("");
    };

    const handleDeleteTime = async (timeId: string) => {
        await deleteDoc(doc(db, "times", timeId));
        setTimes((prev) => prev.filter((t) => t.id !== timeId));
    };

    const handleAddTimeForCategory = async (
        e: React.FormEvent,
        category: string
    ) => {
        e.preventDefault();
        const raw = newTimeNames[category] ?? "";
        const name = raw.trim();
        if (!name) return;

        const colRef = collection(db, "times");
        const docRef = await addDoc(colRef, {
            name,
            category,
            term: selectedTerm,
        });

        const newTime: TimeDoc = {
            id: docRef.id,
            name,
            category,
            term: selectedTerm,
        };
        setTimes((prev) => [...prev, newTime]);

        setNewTimeNames((prev) => ({
            ...prev,
            [category]: "",
        }));
    };

    if (loading) return <p>Laster oppsett...</p>;

    return (
        <div>
            <h3>Times og krav per termin</h3>
            <p>
                Velg termin. Legg til kategorier (f.eks. Kirurgi, Indremedisin), sett
                krav, og administrer timene (Ortopedi 1 osv.) under hver kategori.
            </p>

            <div style={{ marginBottom: "1rem" }}>
                <label>Termin</label>
                <br />
                <select
                    value={selectedTerm}
                    onChange={(e) => setSelectedTerm(parseInt(e.target.value, 10))}
                >
                    {termOptions.map((t) => (
                        <option key={t} value={t}>
                            Termin {t}
                        </option>
                    ))}
                </select>
            </div>

            {/* Kategorier + krav + timer under hver kategori */}
            <section style={{ marginBottom: "2rem" }}>
                <h4>Kategorier og timer – termin {selectedTerm}</h4>

                {requirementsForTerm.length === 0 ? (
                    <p style={{ fontSize: "0.9rem", color: "#6b7280" }}>
                        Ingen kategorier/krav satt for denne terminen ennå.
                    </p>
                ) : (
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "1rem",
                        }}
                    >
                        {requirementsForTerm.map((req) => {
                            const catTimes = timesForTerm
                                .filter((t) => t.category === req.category)
                                .sort((a, b) =>
                                    a.name.localeCompare(b.name, "nb-NO", {
                                        sensitivity: "base",
                                    })
                                );

                            const inputValue = newTimeNames[req.category] ?? "";

                            return (
                                <div
                                    key={req.id}
                                    style={{
                                        border: "1px solid #e5e7eb",
                                        borderRadius: "0.75rem",
                                        padding: "0.75rem",
                                        background: "#f9fafb",
                                    }}
                                >
                                    <div
                                        style={{
                                            display: "flex",
                                            justifyContent: "space-between",
                                            gap: "1rem",
                                            alignItems: "center",
                                            marginBottom: "0.5rem",
                                        }}
                                    >
                                        <div>
                                            <div style={{ fontWeight: 600 }}>
                                                {req.category}
                                            </div>
                                            <div
                                                style={{
                                                    fontSize: "0.8rem",
                                                    color: "#6b7280",
                                                }}
                                            >
                                                Krav for termin {selectedTerm}
                                            </div>
                                        </div>
                                        <div
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: "0.5rem",
                                            }}
                                        >
                                            <span style={{ fontSize: "0.85rem" }}>Krav:</span>
                                            <input
                                                type="number"
                                                min={0}
                                                value={req.requiredCount}
                                                onChange={(e) =>
                                                    handleChangeRequired(
                                                        req.id,
                                                        parseInt(e.target.value, 10) || 0
                                                    )
                                                }
                                                style={{ width: "4rem" }}
                                            />
                                            <button onClick={() => handleDeleteRequirement(req.id)}>
                                                Slett kategori
                                            </button>
                                        </div>
                                    </div>

                                    {/* Timer under denne kategorien */}
                                    <div>
                                        <div
                                            style={{
                                                fontSize: "0.85rem",
                                                marginBottom: "0.25rem",
                                                fontWeight: 500,
                                            }}
                                        >
                                            Timer i denne kategorien
                                        </div>
                                        {catTimes.length === 0 ? (
                                            <p
                                                style={{
                                                    fontSize: "0.8rem",
                                                    color: "#6b7280",
                                                    margin: 0,
                                                }}
                                            >
                                                Ingen timer registrert i denne kategorien ennå.
                                            </p>
                                        ) : (
                                            <ul
                                                style={{
                                                    listStyle: "none",
                                                    padding: 0,
                                                    margin: 0,
                                                    display: "flex",
                                                    flexDirection: "column",
                                                    gap: "0.25rem",
                                                }}
                                            >
                                                {catTimes.map((t) => (
                                                    <li
                                                        key={t.id}
                                                        style={{
                                                            display: "flex",
                                                            justifyContent: "space-between",
                                                            alignItems: "center",
                                                            background: "white",
                                                            borderRadius: "0.5rem",
                                                            padding: "0.3rem 0.5rem",
                                                            border: "1px solid #e5e7eb",
                                                        }}
                                                    >
                                                        <span>{t.name}</span>
                                                        <button
                                                            onClick={() => handleDeleteTime(t.id)}
                                                            style={{ fontSize: "0.8rem" }}
                                                        >
                                                            Slett time
                                                        </button>
                                                    </li>
                                                ))}
                                            </ul>
                                        )}

                                        {/* Legg til time i denne kategorien */}
                                        <form
                                            onSubmit={(e) =>
                                                handleAddTimeForCategory(e, req.category)
                                            }
                                            style={{
                                                marginTop: "0.4rem",
                                                display: "flex",
                                                gap: "0.5rem",
                                                alignItems: "center",
                                            }}
                                        >
                                            <input
                                                value={inputValue}
                                                onChange={(e) =>
                                                    setNewTimeNames((prev) => ({
                                                        ...prev,
                                                        [req.category]: e.target.value,
                                                    }))
                                                }
                                                placeholder="Ny time, f.eks. Ortopedi 1"
                                                style={{
                                                    flex: 1,
                                                    padding: "0.3rem 0.4rem",
                                                    borderRadius: "0.4rem",
                                                    border: "1px solid #d1d5db",
                                                    fontSize: "0.85rem",
                                                }}
                                            />
                                            <button type="submit" style={{ fontSize: "0.85rem" }}>
                                                Legg til time
                                            </button>
                                        </form>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Legg til ny kategori */}
                <form onSubmit={handleAddRequirement} style={{ marginTop: "0.75rem" }}>
                    <label style={{ fontSize: "0.8rem" }}>
                        Legg til kategori for termin {selectedTerm}
                    </label>
                    <br />
                    <input
                        value={newReqCategory}
                        onChange={(e) => setNewReqCategory(e.target.value)}
                        placeholder="Kirurgi, Indremedisin, Anestesi ..."
                        style={{ marginRight: "0.5rem", width: "60%" }}
                    />
                    <button type="submit">Legg til kategori</button>
                </form>
            </section>
        </div>
    );
}

/* ---------- En blokk per gruppe ---------- */

function CategoryBlock({
                           category,
                           term,
                           requirement,
                           onChangeRequiredCount,
                           onClearRequirement,
                           allActivities,
                           reloadActivities,
                       }: {
    category: Category;
    term: number;
    requirement?: Requirement;
    onChangeRequiredCount: (categoryId: string, count: number) => Promise<void>;
    onClearRequirement: (categoryId: string) => Promise<void>;
    allActivities: Activity[];
    reloadActivities: () => Promise<void>;
}) {
    const [localRequired, setLocalRequired] = useState<number>(
        requirement?.requiredCount ?? 0
    );
    const [newActivityName, setNewActivityName] = useState("");

    // Sync når krav/termin endrer seg
    useEffect(() => {
        setLocalRequired(requirement?.requiredCount ?? 0);
    }, [requirement?.requiredCount, term, category.id]);

    const activitiesInCategory = useMemo(
        () => allActivities.filter((a) => a.categoryId === category.id),
        [allActivities, category.id]
    );

    const matchingSuggestions = useMemo(() => {
        const q = newActivityName.trim().toLowerCase();
        if (!q) return [];
        return allActivities.filter((a) =>
            a.name.toLowerCase().includes(q)
        );
    }, [newActivityName, allActivities]);

    const handleBlurRequired = async () => {
        await onChangeRequiredCount(category.id, localRequired);
    };

    const handleAddActivity = async (e: React.FormEvent) => {
        e.preventDefault();
        const name = newActivityName.trim();
        if (!name) return;

        const existing = allActivities.find(
            (a) => a.name.toLowerCase() === name.toLowerCase()
        );

        if (existing) {
            if (existing.categoryId !== category.id) {
                const ref = doc(db, "activities", existing.id);
                await updateDoc(ref, { categoryId: category.id });
            }
        } else {
            const colRef = collection(db, "activities");
            await addDoc(colRef, {
                name,
                categoryId: category.id,
            });
        }

        setNewActivityName("");
        await reloadActivities();
    };

    const handleUseSuggestion = async (activity: Activity) => {
        if (activity.categoryId !== category.id) {
            const ref = doc(db, "activities", activity.id);
            await updateDoc(ref, { categoryId: category.id });
            await reloadActivities();
        }
        setNewActivityName("");
    };

    return (
        <div
            style={{
                border: "1px solid #e5e7eb",
                borderRadius: "0.75rem",
                padding: "0.75rem 1rem",
                background: "#f9fafb",
            }}
        >
            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "1rem",
                    alignItems: "center",
                }}
            >
                <div>
                    <strong>{category.name}</strong>
                </div>
                <div>
                    <label style={{ fontSize: "0.8rem" }}>
                        Krav (antall timer) – termin {term}
                    </label>
                    <br />
                    <input
                        type="number"
                        min={0}
                        value={localRequired}
                        onChange={(e) =>
                            setLocalRequired(parseInt(e.target.value, 10) || 0)
                        }
                        onBlur={handleBlurRequired}
                        style={{ width: "5rem", marginRight: "0.5rem" }}
                    />
                    {requirement && (
                        <button
                            type="button"
                            onClick={() => onClearRequirement(category.id)}
                            style={{ fontSize: "0.75rem" }}
                        >
                            Fjern krav
                        </button>
                    )}
                </div>
            </div>

            <div style={{ marginTop: "0.75rem" }}>
                <div style={{ fontWeight: 500, marginBottom: "0.25rem" }}>
                    Timer i denne gruppen
                </div>
                {activitiesInCategory.length === 0 ? (
                    <p style={{ fontSize: "0.85rem", color: "#6b7280" }}>
                        Ingen timer registrert ennå.
                    </p>
                ) : (
                    <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
                        {activitiesInCategory.map((a) => (
                            <li key={a.id}>{a.name}</li>
                        ))}
                    </ul>
                )}
            </div>

            <form onSubmit={handleAddActivity} style={{ marginTop: "0.75rem" }}>
                <label style={{ fontSize: "0.8rem" }}>
                    Legg til time i {category.name}
                </label>
                <br />
                <input
                    value={newActivityName}
                    onChange={(e) => setNewActivityName(e.target.value)}
                    placeholder="Ortopedi 1, Fys.med 2 ..."
                    style={{ marginRight: "0.5rem", width: "60%" }}
                />
                <button type="submit">Legg til / bruk</button>
            </form>

            {newActivityName.trim() && matchingSuggestions.length > 0 && (
                <div style={{ marginTop: "0.5rem", fontSize: "0.8rem" }}>
                    <div style={{ marginBottom: "0.25rem" }}>Forslag:</div>
                    <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
                        {matchingSuggestions.slice(0, 5).map((a) => (
                            <li key={a.id}>
                                {a.name}{" "}
                                {a.categoryId === category.id ? (
                                    <span style={{ color: "#16a34a" }}>
                    (allerede i denne gruppen)
                  </span>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => handleUseSuggestion(a)}
                                        style={{ marginLeft: "0.5rem", fontSize: "0.75rem" }}
                                    >
                                        Flytt til {category.name}
                                    </button>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}

/* ---------- Bruker-admin ---------- */

function UsersAdmin() {
    const [users, setUsers] = useState<UserRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");

    const loadUsers = async () => {
        setLoading(true);
        const snap = await getDocs(collection(db, "users"));
        const list: UserRow[] = snap.docs.map((d) => {
            const data = d.data() as AppUser;
            return {
                ...data,
                docId: d.id,
            };
        });
        setUsers(list);
        setLoading(false);
    };

    useEffect(() => {
        loadUsers();
    }, []);

    const updateUserField = async (
        docId: string,
        field: keyof AppUser,
        value: any
    ) => {
        const ref = doc(db, "users", docId);
        await updateDoc(ref, { [field]: value });
        setUsers((prev) =>
            prev.map((u) => (u.docId === docId ? { ...u, [field]: value } : u))
        );
    };

    const matchesSearch = (u: UserRow) => {
        if (!search.trim()) return true;
        const q = search.trim().toLowerCase();
        const name = (u.displayName || "").toLowerCase();
        const email = (u.email || "").toLowerCase();
        return name.includes(q) || email.includes(q);
    };

    const limit10 = (list: UserRow[]) => list.slice(0, 10);

    const teachers = limit10(
        users.filter((u) => u.role === "teacher" && matchesSearch(u))
    );
    const students = limit10(
        users.filter((u) => u.role === "student" && matchesSearch(u))
    );
    const admins = limit10(
        users.filter((u) => u.role === "admin" && matchesSearch(u))
    );

    if (loading) return <p>Laster brukere...</p>;

    return (
        <div>
            <h3>Brukere</h3>
            <p>
                Sett roller (<code>student</code>, <code>teacher</code>,{" "}
                <code>admin</code>). Bare studenter har termin og status for semester.
            </p>

            <div style={{ marginBottom: "1rem" }}>
                <label>Søk på navn eller e-post</label>
                <br />
                <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Søk..."
                    style={{ maxWidth: "300px" }}
                />
                <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                    Viser maks 10 treff per seksjon.
                </div>
            </div>

            {/* STUDENTER */}
            <section style={{ marginBottom: "1.5rem" }}>
                <h4>Studenter</h4>
                {students.length === 0 ? (
                    <p style={{ fontSize: "0.85rem", color: "#6b7280" }}>
                        Ingen studenter (eller ingen som matcher søket).
                    </p>
                ) : (
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                        <tr>
                            <th
                                style={{
                                    borderBottom: "1px solid #ddd",
                                    textAlign: "left",
                                    padding: "0.3rem",
                                }}
                            >
                                Navn / e-post
                            </th>
                            <th
                                style={{
                                    borderBottom: "1px solid #ddd",
                                    textAlign: "left",
                                    padding: "0.3rem",
                                }}
                            >
                                Rolle
                            </th>
                            <th
                                style={{
                                    borderBottom: "1px solid #ddd",
                                    textAlign: "left",
                                    padding: "0.3rem",
                                }}
                            >
                                Termin
                            </th>
                            <th
                                style={{
                                    borderBottom: "1px solid #ddd",
                                    textAlign: "left",
                                    padding: "0.3rem",
                                }}
                            >
                                Status semester
                            </th>
                        </tr>
                        </thead>
                        <tbody>
                        {students.map((u) => (
                            <tr key={u.docId}>
                                <td
                                    style={{
                                        padding: "0.3rem",
                                        borderBottom: "1px solid #f3f4f6",
                                    }}
                                >
                                    <div>{u.displayName || u.email}</div>
                                    <div
                                        style={{ fontSize: "0.75rem", color: "#6b7280" }}
                                    >
                                        {u.email}
                                    </div>
                                </td>
                                <td
                                    style={{
                                        padding: "0.3rem",
                                        borderBottom: "1px solid #f3f4f6",
                                    }}
                                >
                                    <select
                                        value={u.role}
                                        onChange={(e) =>
                                            updateUserField(
                                                u.docId,
                                                "role",
                                                e.target.value as AppUser["role"]
                                            )
                                        }
                                    >
                                        <option value="student">student</option>
                                        <option value="teacher">teacher</option>
                                        <option value="admin">admin</option>
                                    </select>
                                </td>
                                <td
                                    style={{
                                        padding: "0.3rem",
                                        borderBottom: "1px solid #f3f4f6",
                                    }}
                                >
                                    <select
                                        value={u.term ?? ""}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            updateUserField(
                                                u.docId,
                                                "term",
                                                val ? parseInt(val, 10) : null
                                            );
                                        }}
                                    >
                                        <option value="">-</option>
                                        {[1,2,3,4,5,6,7,8,9,10,11,12].map((t) => (
                                            <option key={t} value={t}>
                                                {t}
                                            </option>
                                        ))}
                                    </select>
                                </td>
                                <td
                                    style={{
                                        padding: "0.3rem",
                                        borderBottom: "1px solid #f3f4f6",
                                    }}
                                >
                                    <select
                                        value={u.semesterStatus || "aktiv"}
                                        onChange={(e) =>
                                            updateUserField(
                                                u.docId,
                                                "semesterStatus",
                                                e.target.value
                                            )
                                        }
                                    >
                                        <option value="aktiv">aktiv</option>
                                        <option value="friår">friår</option>
                                        <option value="permisjon">permisjon</option>
                                        <option value="forskning">forskningslinje</option>
                                        <option value="ikke_aktuell">ikke aktuell</option>
                                    </select>
                                </td>
                            </tr>
                        ))}
                        </tbody>
                    </table>
                )}
            </section>

            {/* LÆRERE */}
            <section style={{ marginBottom: "1.5rem" }}>
                <h4>Lærere</h4>
                {teachers.length === 0 ? (
                    <p style={{ fontSize: "0.85rem", color: "#6b7280" }}>
                        Ingen lærere (eller ingen som matcher søket).
                    </p>
                ) : (
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                        <tr>
                            <th
                                style={{
                                    borderBottom: "1px solid #ddd",
                                    textAlign: "left",
                                    padding: "0.3rem",
                                }}
                            >
                                Navn / e-post
                            </th>
                            <th
                                style={{
                                    borderBottom: "1px solid #ddd",
                                    textAlign: "left",
                                    padding: "0.3rem",
                                }}
                            >
                                Rolle
                            </th>
                        </tr>
                        </thead>
                        <tbody>
                        {teachers.map((u) => (
                            <tr key={u.docId}>
                                <td
                                    style={{
                                        padding: "0.3rem",
                                        borderBottom: "1px solid #f3f4f6",
                                    }}
                                >
                                    <div>{u.displayName || u.email}</div>
                                    <div
                                        style={{ fontSize: "0.75rem", color: "#6b7280" }}
                                    >
                                        {u.email}
                                    </div>
                                </td>
                                <td
                                    style={{
                                        padding: "0.3rem",
                                        borderBottom: "1px solid #f3f4f6",
                                    }}
                                >
                                    <select
                                        value={u.role}
                                        onChange={(e) =>
                                            updateUserField(
                                                u.docId,
                                                "role",
                                                e.target.value as AppUser["role"]
                                            )
                                        }
                                    >
                                        <option value="teacher">teacher</option>
                                        <option value="student">student</option>
                                        <option value="admin">admin</option>
                                    </select>
                                </td>
                            </tr>
                        ))}
                        </tbody>
                    </table>
                )}
            </section>

            {/* ADMIN */}
            <section style={{ marginBottom: "1.5rem" }}>
                <h4>Administratorer</h4>
                {admins.length === 0 ? (
                    <p style={{ fontSize: "0.85rem", color: "#6b7280" }}>
                        Ingen administratorer (eller ingen som matcher søket).
                    </p>
                ) : (
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                        <tr>
                            <th
                                style={{
                                    borderBottom: "1px solid #ddd",
                                    textAlign: "left",
                                    padding: "0.3rem",
                                }}
                            >
                                Navn / e-post
                            </th>
                            <th
                                style={{
                                    borderBottom: "1px solid #ddd",
                                    textAlign: "left",
                                    padding: "0.3rem",
                                }}
                            >
                                Rolle
                            </th>
                        </tr>
                        </thead>
                        <tbody>
                        {admins.map((u) => (
                            <tr key={u.docId}>
                                <td
                                    style={{
                                        padding: "0.3rem",
                                        borderBottom: "1px solid #f3f4f6",
                                    }}
                                >
                                    <div>{u.displayName || u.email}</div>
                                    <div
                                        style={{ fontSize: "0.75rem", color: "#6b7280" }}
                                    >
                                        {u.email}
                                    </div>
                                </td>
                                <td
                                    style={{
                                        padding: "0.3rem",
                                        borderBottom: "1px solid #f3f4f6",
                                    }}
                                >
                                    <select
                                        value={u.role}
                                        onChange={(e) =>
                                            updateUserField(
                                                u.docId,
                                                "role",
                                                e.target.value as AppUser["role"]
                                            )
                                        }
                                    >
                                        <option value="admin">admin</option>
                                        <option value="teacher">teacher</option>
                                        <option value="student">student</option>
                                    </select>
                                </td>
                            </tr>
                        ))}
                        </tbody>
                    </table>
                )}
            </section>
        </div>
    );
}

export default AdminPage;