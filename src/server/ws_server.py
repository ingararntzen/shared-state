import asyncio
import websockets


async def handler(websocket, path):
    print(f"Client connected: {websocket.remote_address}")
    try:
        async for message in websocket:
            print(f"Received: {message}")
            await websocket.send(f"Echo: {message}")
    except websockets.exceptions.ConnectionClosed:
        print(f"Client disconnected: {websocket.remote_address}")


async def main():
    server = await websockets.serve(handler, "0.0.0.0", 9000)
    print("WebSocket server started on ws://0.0.0.0:9000")
    await server.wait_closed()

asyncio.run(main())