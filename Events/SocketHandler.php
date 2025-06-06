<?php
namespace App\Sockets;

use Ratchet\MessageComponentInterface;
use Ratchet\ConnectionInterface;
use Illuminate\Support\Facades\Log;

class SocketHandler implements MessageComponentInterface
{
    public function onOpen(ConnectionInterface $conn)
    {
        // This will be the connection from your Bun server
        Log::info("New connection from Bun server! ({$conn->resourceId})");
    }

    public function onMessage(ConnectionInterface $from, $msg)
    {
        Log::info("Command received from Bun server: {$msg}");

        $data = json_decode($msg, true);

        // Here, you process the command
        // For example, dispatch a job for background processing
        if (isset($data['command']) && $data['command'] === 'process-data') {
            // IMPORTANT: You are outside the normal HTTP request cycle.
            // If you need the authenticated user, you must pass a token
            // in your message and validate it here.
            \App\Jobs\ProcessSocketData::dispatch($data['payload']);
        }
    }

    public function onClose(ConnectionInterface $conn)
    {
        Log::info("Connection from Bun server has closed ({$conn->resourceId})");
    }

    public function onError(ConnectionInterface $conn, \Exception $e)
    {
        Log::error("An error has occurred: {$e->getMessage()}");
        $conn->close();
    }
}