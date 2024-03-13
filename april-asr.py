#!/usr/bin/env python

import asyncio
from websockets.server import serve
from typing import List
import april_asr as april
from os import getenv

ws = None
session = None

def resultHandler(result_type: april.Result, tokens: List[april.Token]):
    prefix = "."
    if result_type == april.Result.FINAL_RECOGNITION:
        prefix = "@"
    elif result_type == april.Result.PARTIAL_RECOGNITION:
        prefix = "-"

    string = ""
    for token in tokens:
        string += token.token

    print(f"Result {prefix}{string}")

async def stream(websocket):
    global ws
    ws = websocket
    async for message in websocket:
        session.feed_pcm16(message)

async def main():
    # Load the model
    model = april.Model(getenv('APPDATA') + '/live-captions/april-asr/model.april')

    # Create a session
    global session
    session = april.Session(model, resultHandler)

    print("Model " + model.get_name() + " loaded.")

    async with serve(stream, "localhost", 8765):
        print("Server started on port 8765")
        await asyncio.Future()  # run forever

asyncio.run(main())
