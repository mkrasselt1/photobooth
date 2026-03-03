<?php

namespace Photobooth\Configuration\Section;

use Symfony\Component\Config\Definition\Builder\NodeDefinition;
use Symfony\Component\Config\Definition\Builder\TreeBuilder;

final class CoinAcceptorConfiguration
{
    public static function getNode(): NodeDefinition
    {
        return (new TreeBuilder('coinacceptor'))->getRootNode()->addDefaultsIfNotSet()
            ->ignoreExtraKeys()
            ->children()
                ->booleanNode('enabled')->defaultValue(false)->end()
                ->scalarNode('serial_port')->defaultValue('/dev/ttyUSB0')->end()
                ->integerNode('baud_rate')
                    ->defaultValue(9600)
                    ->beforeNormalization()
                        ->ifString()
                        ->then(function (string $value): int { return intval($value); })
                        ->end()
                    ->end()
                ->enumNode('protocol')
                    ->values(['pulse', 'byte_value', 'ascii'])
                    ->defaultValue('pulse')
                    ->end()
                ->integerNode('pulse_value')
                    ->defaultValue(10)
                    ->beforeNormalization()
                        ->ifString()
                        ->then(function (string $value): int { return intval($value); })
                        ->end()
                    ->end()
                ->scalarNode('serverip')->defaultValue('localhost')->end()
                ->integerNode('port')
                    ->defaultValue(14712)
                    ->beforeNormalization()
                        ->ifString()
                        ->then(function (string $value): int { return intval($value); })
                        ->end()
                    ->end()
                ->integerNode('price_picture')
                    ->defaultValue(0)
                    ->beforeNormalization()
                        ->ifString()
                        ->then(function (string $value): int { return intval($value); })
                        ->end()
                    ->end()
                ->integerNode('price_print')
                    ->defaultValue(100)
                    ->beforeNormalization()
                        ->ifString()
                        ->then(function (string $value): int { return intval($value); })
                        ->end()
                    ->end()
                ->booleanNode('show_credits')->defaultValue(true)->end()
                ->scalarNode('ascii_coin_map')->defaultValue('')->end()
            ->end();
    }
}
