"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const server_1 = require("./server");
const audify_1 = require("audify");
const speech_1 = __importDefault(require("./speech"));
const fs = __importStar(require("fs"));
const config_manager_1 = __importDefault(require("./util/config_manager"));
const developmentGibberish_1 = require("./util/developmentGibberish");
const PROGRAM_FOLDER = process.env.APPDATA + '/live-captions';
let server;
let clients = [];
let speeches = [];
function start() {
    return __awaiter(this, void 0, void 0, function* () {
        // Kill server and speeches if they're already running
        if (server !== undefined) {
            server.close();
        }
        speeches.forEach(speech => {
            speech.stop();
        });
        speeches = [];
        // Create program folder
        if (!fs.existsSync(PROGRAM_FOLDER)) {
            fs.mkdirSync(PROGRAM_FOLDER);
            console.log('Created ' + PROGRAM_FOLDER);
        }
        // Generate/load config
        const config = new config_manager_1.default(PROGRAM_FOLDER + '/config.json');
        // Create a asio interface
        const rtAudio = new audify_1.RtAudio(7 /* RtAudioApi.WINDOWS_WASAPI */);
        // Start web server
        server = (0, server_1.server)(config, clients, start, rtAudio);
        // For development testing simulating semi-realistic captions
        if (process.argv.includes('--gibberish')) {
            (0, developmentGibberish_1.gibberish)(clients, 2);
            return;
        }
        // Start speech recognition
        if (!Array.isArray(config.config.server.devices))
            return;
        for (let device of config.config.server.devices) {
            console.log(device);
            const rtAudio = new audify_1.RtAudio(7 /* RtAudioApi.WINDOWS_WASAPI */);
            const speech = new speech_1.default(config, device, rtAudio, clients);
            speech.startStreaming();
            speeches.push(speech);
        }
    });
}
;
start();
