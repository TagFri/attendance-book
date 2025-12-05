import { useEffect, useMemo } from "react";

type QrScannerProps = {
    onCode: (text: string) => void;
    onError?: (error: unknown) => void;
};

const QrScanner: React.FC<QrScannerProps> = ({ onCode, onError }) => {
    // Unik container-id per instans for å unngå kollisjoner
    const elementId = useMemo(() => `qr-reader-${Math.random().toString(36).slice(2)}` , []);

    useEffect(() => {
        let html5QrCode: any | null = null;
        let started = false;
        let cancelled = false;
        let startTimer: number | undefined;

        const startScanner = async () => {
            let Html5QrcodeClass: any;
            try {
                const mod = await import("html5-qrcode");
                Html5QrcodeClass = mod.Html5Qrcode;
            } catch (e) {
                console.warn("QR: klarte ikke å laste html5-qrcode-modulen", e);
                onError?.(e);
                return;
            }

            try {
                html5QrCode = new Html5QrcodeClass(elementId);
            } catch (e) {
                console.warn("QR: konstruktør-feil for Html5Qrcode", e);
                onError?.(e);
                return;
            }

            // Timeout i tilfelle start henger (nettleser/permission)
            startTimer = window.setTimeout(() => {
                if (!started && !cancelled) {
                    console.warn("QR: start timeout – ingen respons fra kamera på 7s");
                    onError?.(new Error("QR start timeout"));
                }
            }, 7000);

            html5QrCode
                .start(
                    { facingMode: "environment" },
                    {
                        fps: 10,
                        qrbox: 250,
                    },
                    (decodedText: string) => {
                        onCode(decodedText);
                    },
                    () => {
                        // Ignorerer scanning errors stille
                    }
                )
                .then(() => {
                    started = true;
                    if (startTimer) window.clearTimeout(startTimer);
                })
                .catch((err: unknown) => {
                    if (startTimer) window.clearTimeout(startTimer);
                    if (cancelled) return;
                    console.warn("Kunne ikke starte QR-leser:", err);
                    onError?.(err);
                });
        };

        void startScanner();

        return () => {
            cancelled = true;
            if (startTimer) window.clearTimeout(startTimer);
            if (!html5QrCode) return;

            // Forsøk alltid å stoppe kameraet selv om .start() ikke rakk å fullføre.
            const stopPromise = html5QrCode
                .stop()
                .catch(() => {
                    // Ignorerer stop-feil (f.eks. hvis ikke startet)
                })
                .then(() => {
                    try {
                        html5QrCode?.clear();
                    } catch (e) {
                        // Ignorerer clear-feil
                    }
                });

            // Ekstra sikring: Stopp eventuelle MediaStream-tracks hvis biblioteket ikke
            // rakk å rydde opp selv (kan skje ved rask lukking av modal).
            stopPromise.finally(() => {
                try {
                    const container = document.getElementById(elementId);
                    const video = container?.querySelector("video") as HTMLVideoElement | null;
                    const stream = (video?.srcObject as MediaStream | undefined) ?? undefined;
                    if (stream) {
                        stream.getTracks().forEach((t) => {
                            try { t.stop(); } catch { /* ignore */ }
                        });
                        // @ts-expect-error allow clear
                        if (video) (video as any).srcObject = null;
                    }
                } catch {
                    // Ignorerer fallback-feil
                }
            });
        };
    }, [elementId, onCode, onError]);

    return <div id={elementId} style={{ width: "100%" }} />;
};

export default QrScanner;