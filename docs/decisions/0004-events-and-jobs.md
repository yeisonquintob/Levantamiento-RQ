# ADR-0004: Separación de eventos y trabajos

## Estado

Aceptada.

## Decisión

RabbitMQ o Azure Service Bus administrará eventos entre servicios.
BullMQ y Redis administrarán trabajos internos y reintentables.
