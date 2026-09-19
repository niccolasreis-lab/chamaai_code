# Correção da ativação de serial

## Problema

Algumas estações permaneciam na tela **Sistema Bloqueado** mesmo após a troca
do serial por uma chave nova. O fluxo também podia reutilizar o resultado de
uma validação diária da chave anterior.

## Correção aplicada

- O serial é normalizado antes da validação: espaços e quebras de linha são
  removidos e a chave é comparada sem diferença entre maiúsculas e minúsculas.
- Uma nova tentativa de ativação remove o cache diário da chave anterior.
- Respostas HTTP `403` e `409` exibem a causa correta para o administrador.
- A Edge Function `chamaai-activate-license` usa a mesma normalização no
  servidor.

## Versão publicada

- Aplicativo: `1.0.178`
- Edge Function: versão `4`, status `ACTIVE`
- Commit da correção: `244aa99`

Ao investigar novamente esse fluxo, validar sempre o aplicativo e a Edge
Function em conjunto. Atualizar apenas o instalador ou apenas a função pode
deixar uma estação usando comportamento antigo.
