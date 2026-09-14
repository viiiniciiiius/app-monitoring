# Monitoramento de Campo

Aplicativo móvel em React Native e Expo para capturar fotografias em intervalos
configuráveis, armazená-las no dispositivo, exportar diagnósticos e transferir
imagens para um servidor HTTP definido pelo usuário.

## Requisitos

- Node.js 20.19.4 ou mais recente;
- npm;
- ambiente Android ou iOS compatível com o Expo SDK 54.

## Configuração local

```bash
npm ci
cp .env.example .env
npm start
```

No Windows PowerShell, substitua `cp` por `Copy-Item`.

Defina `EXPO_PUBLIC_HOST_NAME` no `.env` com o hostname do servidor de upload.
Para associar uma cópia do projeto a uma conta EAS, preencha `EAS_PROJECT_ID`
com o identificador criado na própria conta. O arquivo `.env` não deve ser
versionado.

## Diagnósticos

O aplicativo mantém diagnósticos locais para acompanhar execuções prolongadas.
Consulte [docs/DIAGNOSTICS.md](docs/DIAGNOSTICS.md) para conhecer o formato, a
retenção, a exportação e o analisador incluído no projeto.

Arquivos exportados podem conter identificadores do aparelho, nomes de arquivos,
caminhos locais e outros dados do ambiente. Revise-os antes de compartilhar e
não os adicione ao repositório.

## Licença

Distribuído sob a [licença MIT](LICENSE).
