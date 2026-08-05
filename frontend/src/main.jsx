import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./theme.css";
import "./utils/monacoSetup";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
