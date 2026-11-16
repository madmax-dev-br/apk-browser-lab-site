# Bibliotecas utilizadas

A feature web foi compilada com bibliotecas reais, fixadas no projeto Gradle:

- Kotlin 2.1.21 — JetBrains, Apache License 2.0. Texto em `licenses/Kotlin-Apache-2.0.txt`.
- Compose Multiplatform / Material 3 1.8.2 — JetBrains e contribuidores AndroidX, Apache License 2.0. Texto em `licenses/Compose-Apache-2.0.txt`.
- Skiko 0.9.4.2 — JetBrains, Apache License 2.0. Texto em `licenses/Skiko-Apache-2.0.txt`.
- Skia — Google e contribuidores, licença BSD. Texto em `licenses/Skia-BSD.txt`.
- O bundle JavaScript inclui avisos adicionais em `dist/compose/compose-feature.js.LICENSE.txt`.

Fontes: [Kotlin](https://github.com/JetBrains/kotlin/tree/v2.1.21), [Compose Multiplatform](https://github.com/JetBrains/compose-multiplatform/tree/v1.8.2), [Skiko](https://github.com/JetBrains/skiko/tree/v0.9.4.2), [Skia](https://github.com/google/skia).

O APK Kotlin de teste contém a biblioteca padrão Kotlin. O APK Compose foi gerado com os artefatos AndroidX/Compose resolvidos pelo Gradle. Ambos são fixtures locais do projeto; o APK Compose não é executado pela VM web atual.

REA 6.7.0 e JADX headless 0.7.1 foram usados apenas para análise durante o desenvolvimento. Não são carregados pela aplicação web nem incluídos nos assets de execução.
