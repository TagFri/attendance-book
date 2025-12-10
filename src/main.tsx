import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// Global styles in the required order
import "./styles/1resetNormalize.css";
import "./styles/2variables.css";
import "./styles/4layout.css";
import "./styles/3typography.css";
import "./styles/5footer.css";
import "./styles/6sablaflott.css";
import "./styles/7restCss.css";
import "./styles/8header.css";
import "./styles/9admin.css";
// Page-specific styles (must be last)
import "./index.css"; // Load global styles, including focus outlines for inputs/selects
import { Toaster } from "sonner";
import Footer from "./Footer.tsx";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
        <App />
        <Toaster richColors position="top-center" />
    </React.StrictMode>
);