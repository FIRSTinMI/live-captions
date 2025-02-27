#!/usr/bin/env python

import asyncio
import whisper
from websockets.server import serve
from typing import List
import sys

ws = None
session = None
model = whisper.load_model("base")  # You can use 'small', 'medium', 'large', etc.

def resultHandler(result):
    # Here, Whisper does not return tokens in the same way, but we can print the full result.
    print(f"Result: {result['text']}")
    sys.stdout.flush() 

async def stream(websocket):
    global ws
    ws = websock
    audio_buffer = b""

    async for message in websocket:
        audio_buffer += message

        # Let's assume we get audio chunks and transcribe after receiving a batch.
        # You can adjust the chunk size depending on your needs.
        if len(audio_buffer) > 16000:  # 1-second chunk for 16kHz audio
            result = model.transcribe(audio_buffer)
            resultHandler(result)
            audio_buffer = b""  # Clear the buffer for the next chunk

async def main():
    # You can change the model name here based on what you'd like to use.
    # The Whisper model loads here (you can choose 'small', 'medium', or 'large')
    print("Whisper-3 model loaded.")
    sys.stdout.flush() 

    port = 8760  # Default port for WebSocket server

    async with serve(stream, "localhost", port):
        print(f"Server started on port {port}")
        sys.stdout.flush()
        await asyncio.Future()  # run forever

asyncio.run(main())
