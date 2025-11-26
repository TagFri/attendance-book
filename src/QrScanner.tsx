import { useEffect } from "react";
import { Html5Qrcode } from "html5-qrcode";

type QrScannerProps = {
    onCode: (text: string) => void;
};

const QrScanner: React.FC<QrScannerProps> = ({ onCode }) => {
    useEffect(() => {
        const elementId = "qr-reader";

        const html5QrCode = new Html5Qrcode(elementId);

        html5QrCode
            .start(
                { facingMode: "environment" },
                {
                    fps: 10,
                    qrbox: 250,
                },
                (decodedText) => {
                    onCode(decodedText);
                },
                () => {
                    // Ignorerer scanning errors stille
                }
            )
            .catch((err) => {
                console.error("Kunne ikke starte QR-leser:", err);
            });

        return () => {
            html5QrCode
                .stop()
                .then(() => html5QrCode.clear())
                .catch(() => {
                    // Ignorerer stop/clear-feil
                });
        };
    }, [onCode]);

    return <div id="qr-reader" style={{ width: "100%" }} />;
};

export default QrScanner;