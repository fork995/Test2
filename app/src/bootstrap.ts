// Keep React, application initialization and CSS behind a catchable dynamic import.
import { startApplication } from "./startup";
startApplication(() => import("./main"));
