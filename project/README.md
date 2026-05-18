# SejaElevar

Aplicacao web local para visualizar dados, filtrar registros, editar informacoes e gerar documentos.

## Abrir a interface

Para gerar uma pagina unica que pode ser aberta direto no navegador:

```powershell
npm run build:single
```

Depois abra:

```text
dist/SejaElevar.html
```

Esse arquivo e o melhor caminho para revisar a interface visual sem terminal.

Para desenvolvimento com recarregamento automatico, use:

```powershell
npm run dev:open
```

## Ver a versao servida localmente

Se algum recurso futuro precisar de servidor local, use:

```powershell
npm run build
npm start
```

## Ideia para a versao entregue

A versao entregue para uso interno deve ser mais simples para o trabalhador:

- abrir o SejaElevar pelo navegador ou atalho;
- usar uma pasta de trabalho local com planilhas, modelos e documentos gerados;
- evitar comandos de desenvolvimento;
- manter caminho para uma pasta sincronizada no Google Drive no futuro.
