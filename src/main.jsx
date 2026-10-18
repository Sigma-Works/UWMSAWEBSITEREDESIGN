/* Entry point: Vite loads this from index.html and mounts the React app
   into <div id="root">. StrictMode double-invokes effects in development
   only (it has no effect on the production build) to surface bugs early. */
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
