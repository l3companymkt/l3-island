# Claude Island

> **Projeto não oficial.** Não é um produto da Anthropic e não tem vínculo com ela. "Claude" e "Claude Code" são marcas da Anthropic, citadas aqui só para indicar com qual ferramenta o app funciona.

Uma "ilha flutuante" no topo da tela do seu PC (no estilo da ilha dinâmica do iPhone) que acompanha o computador e o Claude Code. Tudo roda **no seu computador**: não há servidor na nuvem, conta ou login.

- **Pílula (compacta):** status do Claude (azul = trabalhando, âmbar = precisa de você) e CPU (verde/âmbar/vermelho).
- **Clique na pílula** (ou **Cmd+Shift+Espaço** no Mac, **Ctrl+Alt+Espaço** no Windows) para expandir o painel:
  - **Sistema:** CPU, núcleos, memória, GPU/bateria, rede, discos e processos mais pesados.
  - **Claude:** consumo da janela de 5 horas e da semana, previsão de quando bate o limite, e as sessões abertas.
  - **Widgets:** relógio, música tocando agora (com controles) e previsão do tempo.
  - **Ajustes (⚙):** plano e limites, tempo de espera das permissões, widgets, QR code do celular.
- **Pedido de permissão:** quando o Claude precisa de autorização, a ilha se abre como uma "chamada recebida" com **Negar / Terminal / Permitir**, e aparece uma notificação do sistema.
- **No celular:** escaneie o QR code em Ajustes (mesma rede Wi‑Fi). Dá para ver as sessões e aprovar ou negar pedidos de lá. O celular vibra quando chega um pedido.
- **Abre junto com o Claude:** quando você inicia uma sessão do Claude Code, a ilha abre sozinha.

## Instalação (uma vez)

Precisa do [Node.js](https://nodejs.org) 18 ou mais novo (`node -v` no Terminal mostra a versão).

Baixe o ZIP em **Code → Download ZIP** nesta página e leve a pasta para a sua pasta pessoal:

```bash
mv ~/Downloads/claude-island-main ~/claude-island
```

```bash
cd ~/claude-island
```

```bash
npm install
```

```bash
npm run install-hooks
```

```bash
npm run abrir
```

O `npm run abrir` abre a ilha solta do Terminal: depois pode fechar o Terminal. (O `npm start` também abre, mas a ilha fecha junto com o Terminal.) Para ela abrir sempre que o Mac ligar, ative **Iniciar com o computador** em Ajustes ou no ícone da barra de menus.

O `install-hooks` adiciona os hooks do Claude Island no `~/.claude/settings.json` (faz backup antes e mantém os hooks que você já tinha). A partir daí, toda vez que você abrir o Claude Code a ilha abre junto.

Para remover os hooks:

```bash
npm run uninstall-hooks
```

No Mac, na primeira vez o sistema pergunta se o app pode mostrar notificações: permita. A ilha fica logo abaixo da barra de menus e o ícone aparece na barra de menus (não no Dock).

## Atualizar

```bash
cd ~/claude-island && npm run atualizar
```

Antes, baixe o ZIP novo (**Code → Download ZIP**) e deixe em Downloads. O comando troca os arquivos, apaga o ZIP de Downloads, instala o que mudou e reabre a ilha. Se a pasta tiver sido clonada com git, ele usa `git pull` no lugar do ZIP.

## Como funciona

| Parte | O que faz |
|---|---|
| `electron/` | A janela da ilha (sem borda, transparente, sempre por cima), ícone na bandeja e notificações. |
| `server/` | Servidor local na porta `4777`: lê o sistema, os transcripts do Claude Code (`~/.claude/projects`), a música e o tempo. |
| `hooks/island-hook.js` | Hook do Claude Code: avisa o status das sessões, abre a ilha no `SessionStart` e espera sua resposta nos pedidos de permissão (`PermissionRequest`). |
| `public/` | A interface (a mesma no PC e no celular). |

- **Permissões:** o Claude espera sua resposta na ilha pelo tempo definido em Ajustes (padrão: 5 minutos). Se você não responder, tocar em **Terminal** ou a ilha estiver fechada, a pergunta aparece normalmente no terminal. Enquanto a ilha espera, responda por ela (ou pelo celular).
- **Limites de uso** são **estimativas**: a Anthropic não publica os limites em tokens. O painel soma os tokens dos seus transcripts por janela de 5h e por 7 dias. Quando o Claude avisar que você chegou no limite, toque em **"Bati o limite agora"**: o painel passa a usar o seu limite real.
- **Música:** Windows (qualquer app que apareça nos controles de mídia do sistema, como Spotify e navegador), macOS (Spotify e Music) e Linux (`playerctl`).
- **Tempo:** usa a Open-Meteo, gratuita e sem chave. É o único recurso que precisa de internet.

## Segurança

- A configuração e a chave de acesso ficam em `~/.claude-island/config.json`. **Não compartilhe** o link ou o QR code: quem tiver a chave pode aprovar comandos do Claude.
- O acesso pelo celular só funciona na mesma rede. Em rede pública (café, aeroporto), desligue **"Permitir acesso pela rede"** em Ajustes. Para usar fora de casa sem nuvem, uma opção é a [Tailscale](https://tailscale.com) (VPN direta entre seus aparelhos).
- No Windows, na primeira vez o Firewall pergunta se o app pode usar a rede: permita em **redes privadas** para o celular funcionar.

## Sem Electron

Dá para rodar só o servidor e abrir no navegador:

```bash
npm run server
```

## Licença

[MIT](LICENSE): pode usar, modificar e distribuir, mantendo o aviso de copyright.
