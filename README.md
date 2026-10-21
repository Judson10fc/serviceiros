# Painel XP — Firebase sem Cloud Functions

Esta versão utiliza HTML, CSS, JavaScript, Firebase Authentication e Firebase Realtime Database. Não utiliza Firebase Cloud Functions nem servidor próprio.

## Integrações e dependências

- O painel usa somente Firebase Authentication e Realtime Database para dados e contas. Não há chamadas a Cloud Functions, Admin SDK, Google Analytics ou APIs administrativas do Google Cloud no código do painel.
- A API Key Web faz parte da configuração pública obrigatória do Firebase SDK; removê-la impediria o Firebase Authentication de funcionar. Ela não é uma senha. A segurança deve ser garantida pelas Security Rules.
- As fontes externas do Google Fonts foram removidas para reduzir requisições externas; o site usa fontes do sistema.

## Configuração

1. No Firebase Console, projeto `service-1d1d3`, confirme que **Authentication > Sign-in method > E-mail/senha** está habilitado.
2. Confirme que o Realtime Database está criado na região correspondente à URL em `config.js`.
3. No Realtime Database > Rules, faça backup das regras atuais e publique o conteúdo de `database.rules.json`. **Não mantenha `.read: true` ou `.write: true`.**
4. Publique os arquivos estáticos em Firebase Hosting ou em outra hospedagem HTTPS estática. Não é necessário servidor próprio nem Cloud Functions. Abrir com `file://` pode impedir fluxos de autenticação/redirecionamento; use o domínio de Hosting para uso real.
5. Em Authentication > Settings > Authorized domains, confirme o domínio em que o painel será aberto.

## Fluxos implementados

- Cadastro público de Serviceiro com nome, nick, e-mail e senha.
- Login de Serviceiro e Cliente com e-mail/senha.
- Cadastro de Cliente pelo Serviceiro com senha provisória de 4 dígitos para Cliente (PIN convertido internamente para atender ao mínimo do Firebase) e senha de 6 dígitos para Serviceiro usando uma segunda instância do Firebase Authentication, sem encerrar a sessão do Serviceiro.
- Perfil vinculado ao UID próprio de cada conta.
- Clientes, apurações e ciclos guardados no Realtime Database.
- Cliente tem portal de consulta do próprio histórico; não recebe ações de edição de apurações/ciclos.
- Arquivamento preserva os registros financeiros.
- Sem Cloud Functions.

## Limitações intencionais sem backend privilegiado

- Sem Cloud Functions/Admin SDK, o Serviceiro **não pode redefinir diretamente a senha de uma conta já criada**. O Cliente deve usar a recuperação de senha por e-mail do Firebase Authentication.
- A conta de Cliente exige e-mail válido, pois ele é o identificador de login e o canal de recuperação.
- As regras protegem as árvores de dados; ainda assim, teste as regras no Rules Playground antes de usar dados reais.
- O cadastro público de Serviceiro permite que qualquer visitante crie uma conta Serviceiro. Se o produto precisar de aprovação/invite obrigatório, isso exige um mecanismo de convite seguro com regras adicionais.
- As chaves de configuração Web são públicas por design; a segurança deve vir das Rules e dos controles do Authentication, nunca de esconder a `apiKey`.

## Estrutura de dados

- `/users/{uid}`: perfil e papel (`serviceiro` ou `client`).
- `/serviceiroData/{serviceiroUid}/customers/{clientUid}`: cadastro/estado do cliente sob responsabilidade do Serviceiro.
- `/serviceiroData/{serviceiroUid}/entries/{entryId}` e `/cycles/{cycleId}`: registros de serviço.
- `/clientData/{clientUid}/profile`, `/entries` e `/cycles`: visão do Cliente, em modo de consulta.

## Verificações locais

Execute `npm run check` para validar sintaxe JS e JSON. Isso é uma verificação estática, não substitui teste de integração com o projeto Firebase real.


## Observação importante sobre segurança e cadastro

Este projeto é uma aplicação estática com Firebase Authentication e Realtime Database, sem Cloud Functions. As regras bloqueiam leitura/gravação pública. Como a aplicação executa no navegador, a segurança efetiva depende das Security Rules e de fluxos compatíveis com o SDK cliente. A criação de uma conta de Cliente usa uma segunda instância de Authentication; redefinir a senha de outra conta depois da criação não é permitido pelo SDK cliente, então o Cliente usa a recuperação por e-mail.

Antes de usar dados reais, teste no Rules Playground (ou Emulator Suite) o cadastro de Serviceiro, cadastro de Cliente, atualização de perfil, criação/edição/exclusão lógica de apuração e leitura do portal do Cliente. A verificação local não prova integração com o projeto Firebase real.


## Regras de senha corrigidas
- Cliente: exatamente 4 dígitos numéricos; o painel converte o PIN em uma credencial interna mais longa porque o Firebase Authentication exige pelo menos 6 caracteres.
- Serviceiro: exatamente 6 dígitos numéricos, tanto no cadastro quanto na troca de senha provisória.
- O PIN de 4 dígitos tem baixa entropia. Para uso real, habilite controles de segurança adicionais e evite reutilizar PINs.
- A recuperação padrão por e-mail do Firebase permite que o usuário defina uma senha convencional; para manter estritamente o PIN de 4 dígitos após uma recuperação seria necessário um fluxo de recuperação específico. Não há Cloud Functions neste projeto.
