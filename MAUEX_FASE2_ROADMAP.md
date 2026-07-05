# MAUex - Fase 2

Fecha: 2026-07-05

## Objetivo

Convertir MAUex de herramienta personal poderosa a sistema mas confiable, entendible y con opcion real de evolucionar a producto.

## 2.1 Confiabilidad operativa

- Dejar un unico panel de scripts oficiales en la raiz.
- Mantener diagnosticos locales que no dependan de Cloudflare.
- Separar pruebas locales, pruebas online y despliegues.
- Agregar un checklist post-deploy: Vercel, Worker, Firestore, Railway y Oracle.
- Registrar errores importantes en una pantalla o archivo de diagnostico legible.

Primer entregable aplicado:

- `MAUEX_FASE2_DIAGNOSTICO_LOCAL.bat`
- `MAUEX_FASE2_DIAGNOSTICO_LOCAL.ps1`

## 2.2 Usabilidad de herramienta personal

- Crear una pantalla de estado: Worker, exchanges, Firebase, token configurado y ultimo sync.
- Mejorar Settings para que quede claro que es token, que es master password y que es secreto de Telegram.
- Mostrar warnings accionables cuando falte algo: token, exchange key, worker bloqueado, Firestore denegado.
- Reducir ruido visual en dashboards y priorizar decisiones: riesgo, capital, PnL, senales abiertas, errores de sync.

## 2.3 Calidad de datos y confianza

- Normalizar balances y posiciones por exchange en un formato unico.
- Guardar fecha de ultima actualizacion por fuente.
- Marcar datos stale cuando una fuente no responde.
- Agregar reconciliacion basica: balance total esperado vs suma por exchange.

## 2.4 Camino a producto

Antes de pensar en venderlo, MAUex necesita separar tres capas:

- Personal: claves, master password, preferencias y datos privados.
- Motor: normalizacion de exchanges, senales, risk tracking y calculos.
- Producto: onboarding, multiusuario, billing, soporte, limites y auditoria.

La oportunidad de producto existe si MAUex logra hacer muy bien una promesa concreta:

- "Unificar capital, riesgo y senales de traders cripto en una sola cabina."

Lo que habria que validar con usuarios:

- Si pagarian por una vista de riesgo multi-exchange.
- Si el diferencial esta en senales, journaling, risk management o automatizacion.
- Si quieren herramienta personal avanzada o SaaS simple.

## 2.5 Proxima tanda recomendada

1. Pantalla de estado dentro de MAUex.
2. Diagnostico post-deploy online cuando baje el 429.
3. Limpieza de Settings: separar token API, master password y secretos de Telegram.
4. Inventario de features actuales para decidir que seria "producto minimo".
