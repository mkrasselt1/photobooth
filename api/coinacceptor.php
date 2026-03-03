<?php

/** @var array $config */

require_once '../lib/boot.php';

use Photobooth\Service\LoggerService;

header('Content-Type: application/json');

$logger = LoggerService::getInstance()->getLogger('main');
$logger->debug(basename($_SERVER['PHP_SELF']));

$csrfKey = 'csrf';
$csrfToken = $_SESSION[$csrfKey] ?? '';
$incomingToken = $_GET[$csrfKey] ?? '';

if (!hash_equals((string) $csrfToken, (string) $incomingToken)) {
    http_response_code(403);
    echo json_encode(['success' => false, 'error' => 'Invalid CSRF token']);
    exit;
}

if (empty($config['coinacceptor']['enabled'])) {
    echo json_encode(['success' => false, 'error' => 'Coin acceptor not enabled']);
    exit;
}

$serverIp = $config['coinacceptor']['serverip'] ?? 'localhost';
$port = $config['coinacceptor']['port'] ?? 14712;
$action = $_GET['action'] ?? 'credits';

try {
    switch ($action) {
        case 'credits':
            $url = 'http://' . $serverIp . ':' . $port . '/credits';
            $response = @file_get_contents($url);
            if ($response === false) {
                throw new \Exception('Could not connect to coin acceptor server');
            }
            echo $response;
            break;

        case 'consume':
            $amount = max(0, (int) ($_GET['amount'] ?? 0));
            $url = 'http://' . $serverIp . ':' . $port . '/consume';
            $context = stream_context_create([
                'http' => [
                    'method' => 'POST',
                    'header' => 'Content-Type: application/json',
                    'content' => json_encode(['amount' => $amount]),
                    'timeout' => 5,
                ],
            ]);
            $response = @file_get_contents($url, false, $context);
            if ($response === false) {
                throw new \Exception('Could not connect to coin acceptor server');
            }
            echo $response;
            break;

        case 'reset':
            $url = 'http://' . $serverIp . ':' . $port . '/reset';
            $context = stream_context_create([
                'http' => [
                    'method' => 'POST',
                    'header' => 'Content-Type: application/json',
                    'content' => '{}',
                    'timeout' => 5,
                ],
            ]);
            $response = @file_get_contents($url, false, $context);
            if ($response === false) {
                throw new \Exception('Could not connect to coin acceptor server');
            }
            echo $response;
            break;

        default:
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'Unknown action']);
    }
} catch (\Exception $e) {
    $logger->error('Coin acceptor API error: ' . $e->getMessage());
    http_response_code(502);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
