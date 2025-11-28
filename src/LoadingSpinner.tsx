import type React from "react";

const LoadingSpinner: React.FC = () => {
    return (
        <div
            style={{
                padding: "1.5rem 0",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
            }}
        >
            <div
                style={{
                    width: "32px",
                    height: "32px",
                    borderRadius: "50%",
                    border: "3px solid #e5e7eb",
                    // Accent color per request
                    borderTopColor: "#2EC483",
                    animation: "spin 1s linear infinite",
                }}
            />
            <style>
                {`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}
            </style>
        </div>
    );
};

export default LoadingSpinner;