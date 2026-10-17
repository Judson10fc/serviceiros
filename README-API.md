# Arquitetura do Painel XP

O Painel XP não utiliza uma API própria nem Firebase Cloud Functions. A comunicação é feita diretamente pelo SDK Web do Firebase Authentication e do Realtime Database.

Para configurar e publicar regras, consulte `README.md` e `database.rules.json`.

## Modelo de segurança

- Cada conta tem UID exclusivo gerado pelo Firebase Authentication.
- O perfil fica em `/users/{uid}`.
- Dados operacionais do Serviceiro ficam em `/serviceiroData/{serviceiroUid}`.
- Cópias de consulta do Cliente ficam em `/clientData/{clientUid}`.
- O Cliente não pode gravar apurações ou ciclos.
- Não são armazenadas senhas no Realtime Database.

## Limitações sem Cloud Functions

O SDK cliente não tem privilégios administrativos para redefinir senhas de outros usuários ou excluir suas contas do Authentication. A recuperação de senha deve ocorrer pelo Firebase Authentication. A exclusão permanente de uma conta exige que o próprio usuário a exclua ou o uso de uma ferramenta administrativa confiável fora do site.
