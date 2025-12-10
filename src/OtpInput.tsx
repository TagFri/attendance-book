import React, {useEffect, useMemo, useRef} from "react";

type OtpInputProps = {
    value: string;
    onChange: (value: string) => void;
    length?: number; // default 6
    disabled?: boolean;
};

// A simple OTP-style input: renders N single-char numeric inputs that behave as one value.
export default function OtpInput({value, onChange, length = 6, disabled}: OtpInputProps) {
    const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

    const digits = useMemo(() => {
        const v = (value || "").replace(/\D/g, "").slice(0, length);
        const arr = new Array(length).fill("");
        for (let i = 0; i < v.length; i++) arr[i] = v[i];
        return arr as string[];
    }, [value, length]);

    const focusIndex = (idx: number) => {
        const el = inputsRef.current[idx];
        if (el) el.focus();
    };

    const setAtIndexRange = (startIdx: number, text: string) => {
        const onlyDigits = text.replace(/\D/g, "");
        if (!onlyDigits) return;
        const current = digits.join("");
        const asArray = current.split("");
        let i = startIdx;
        for (const ch of onlyDigits) {
            if (i >= length) break;
            asArray[i] = ch;
            i++;
        }
        onChange(asArray.join("").slice(0, length));
        if (i <= length - 1) focusIndex(i);
    };

    const handleChange = (idx: number, e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value;
        // If more than one char is typed (mobile paste or fast typing), distribute forward
        if (raw.length > 1) {
            setAtIndexRange(idx, raw);
            return;
        }
        const d = raw.replace(/\D/g, "");
        const arr = digits.slice();
        arr[idx] = d || "";
        const joined = arr.join("");
        onChange(joined);
        if (d && idx < length - 1) {
            focusIndex(idx + 1);
        }
    };

    const handleKeyDown = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
        const key = e.key;
        if (key === "Backspace") {
            if (digits[idx]) {
                // Clear this digit
                const arr = digits.slice();
                arr[idx] = "";
                onChange(arr.join(""));
                // Keep focus here
                e.preventDefault();
            } else if (idx > 0) {
                // Move back and clear previous
                e.preventDefault();
                focusIndex(idx - 1);
                const arr = digits.slice();
                arr[idx - 1] = "";
                onChange(arr.join(""));
            }
        } else if (key === "ArrowLeft" && idx > 0) {
            e.preventDefault();
            focusIndex(idx - 1);
        } else if (key === "ArrowRight" && idx < length - 1) {
            e.preventDefault();
            focusIndex(idx + 1);
        }
    };

    const handlePaste = (idx: number, e: React.ClipboardEvent<HTMLInputElement>) => {
        const text = e.clipboardData.getData("text");
        if (text) {
            e.preventDefault();
            setAtIndexRange(idx, text);
        }
    };

    // Keep refs array length in sync
    useEffect(() => {
        inputsRef.current = inputsRef.current.slice(0, length);
    }, [length]);

    return (
        <div className="" style={{
            display: "flex",
            flexDirection: "row",
            justifyContent: "center",
        }}>
            {digits.map((d, idx) => (
                <input
                    key={idx}
                    ref={(el) => (inputsRef.current[idx] = el)}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="one-time-code"
                    className=""
                    style={{
                        borderRadius: "7.5px",
                        border: "2px solid var(--color-black",
                        width: "2.2rem",
                        height: "3.4rem",
                        margin: "0 0.25rem",
                        padding: "0.5rem 0.25rem",
                        textAlign: "center",
                    }}
                    value={d}
                    onChange={(e) => handleChange(idx, e)}
                    onKeyDown={(e) => handleKeyDown(idx, e)}
                    onPaste={(e) => handlePaste(idx, e)}
                    aria-label={`Kode siffer ${idx + 1}`}
                    disabled={disabled}
                    maxLength={1}
                />
            ))}
        </div>
    );
}
