import { defineConfig } from "eslint/config";
import next from "eslint-config-next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig([{
    extends: [...next],
    rules: {
        "react-hooks/set-state-in-effect": "off",
        "react-hooks/purity": "off",
        "react-hooks/preserve-manual-memoization": "off",
        "react-hooks/immutability": "off",
        "react-hooks/refs": "off",
        "react-hooks/exhaustive-deps": "off",
    },
}]);
