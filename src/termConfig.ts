export type TermOption = {
    value: number;
    label: string;
};

export const TERM_OPTIONS: TermOption[] = [
    // 1.året. Term 1+2
    { value: 101, label: "Modul 1 - Blokk 1" },
    { value: 102, label: "Modul 1 - Blokk 2" },
    { value: 103, label: "Modul 1 - Blokk 3" },

    // 2. året. Term 3+4
    { value: 201, label: "Modul 2 - Termin 1" },
    { value: 202, label: "Modul 2 - Termin 2" },
    { value: 203, label: "Modul 2 - Propen" },

    // 3. året. Term 5+6
    { value: 301, label: "Modul 3 - Termin 1" },
    { value: 302, label: "Modul 3 - Termin 2" },

    // 4. året. Term 7+8
    { value: 4, label: "Modul 4" },
    { value: 5, label: "Modul 5" },

    // 5. året. Term 9+10
    { value: 6, label: "Modul 6" },
    { value: 7, label: "Modul 7" },

    // 6. året. Term 11+12
    { value: 801, label: "Modul 8 - termin 1" },
    { value: 802, label: "Modul 8 - termin 2" },
];

export function termLabel(value: number | null | undefined): string {
    if (!value) return "Ukjent termin";
    const found = TERM_OPTIONS.find((t) => t.value === value);
    return found ? found.label : `Termin ${value}`;
}
// Brukes til å forkorte tekst som "Termin 1 - Blokk 2" -> "M1B2"
export function shortLabelFromFullLabel(label: string): string {
    // Matcher "Modul 1 - Blokk 2" eller "Termin 1 - Blokk 2"
    const blockMatch = /(Modul|Termin)\s+(\d+)\s*-\s*Blokk\s+(\d+)/i;
    const m1 = label.match(blockMatch);
    if (m1) {
        const moduleNum = m1[2];
        const blockNum = m1[3];
        return `M${moduleNum}B${blockNum}`;
    }

    // Matcher "Modul 4" eller "Termin 4"
    const simpleMatch = /(Modul|Termin)\s+(\d+)/i;
    const m2 = label.match(simpleMatch);
    if (m2) {
        const moduleNum = m2[2];
        return `M${moduleNum}`;
    }

    // Fallback – ukjent format, vis full label
    return label;
}

// Global helper: ta term-verdi -> kortlabel (M1B1, M4, osv.)
export function termShortLabel(term?: number | null): string {
    const full = termLabel(term);
    if (!full) return "";
    return shortLabelFromFullLabel(full);
}