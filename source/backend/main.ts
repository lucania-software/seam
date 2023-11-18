import { Application } from "./application/Application.js";

const application = Application.getInstance();

await application.start();