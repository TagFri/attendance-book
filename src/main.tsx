import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css"; // Load global styles, including focus outlines for inputs/selects
import { Toaster } from "sonner";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
        <App />
        <Toaster richColors position="top-center" />
    </React.StrictMode>
);