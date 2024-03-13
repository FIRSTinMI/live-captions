#!/usr/bin/env python

import asyncio
from websockets.server import serve
from typing import List
import april_asr as april
from os import getenv
from psutil import net_connections

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

    ports = []
    for conn in net_connections(kind='inet'):
        if conn.status == 'LISTEN' and conn.laddr.port >= 8760 and conn.laddr.port < 8800:
            ports.append(conn.laddr.port)

    port = 8760
    while port in ports:
        port += 1
        if port >= 8800:
            raise Exception("No available port in range 8760-8800.")

    async with serve(stream, "localhost", port):
        print("Server started on port "+str(port))
        await asyncio.Future()  # run forever

asyncio.run(main())
