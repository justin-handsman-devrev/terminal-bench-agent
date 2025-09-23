# Compatibility Knowledge Base

A comprehensive guide for understanding compatibility issues across programming languages, frameworks, and their versions.

## C++ Language Standards

### C++98/03 → C++11 Migration
**Major Additions**:
- `auto` keyword for type deduction
- Range-based for loops
- Lambda expressions
- `nullptr` instead of `NULL`
- Smart pointers (`std::unique_ptr`, `std::shared_ptr`)
- `constexpr` functions (limited)
- Move semantics and rvalue references

**Compatibility Issues**:
- Old compilers may not support C++11 features
- `constexpr` functions very limited (only simple expressions)

### C++11 → C++14 Migration
**Major Additions**:
- Generic lambdas
- `std::make_unique`
- Binary literals
- Enhanced `constexpr` (loops, conditionals allowed)
- Variable templates
- `auto` return type deduction

**Compatibility Issues**:
- `constexpr` functions become much more flexible
- Template features significantly expanded

### C++14 → C++17 Migration
**Major Additions**:
- Structured bindings
- `if constexpr`
- `std::optional`, `std::variant`
- Fold expressions
- Template argument deduction for class templates
- Inline variables

**Compatibility Issues**:
- Structured bindings change variable declaration syntax
- `if constexpr` affects template instantiation

### C++17 → C++20 Migration
**Major Additions**:
- Concepts
- Modules
- Coroutines
- Ranges library
- Three-way comparison operator (`<=>`)
- `consteval` and `constinit`

**Verification Patterns**:
```bash
# Test specific standard compatibility
g++ -std=c++11 -Wall -Werror file.cpp
g++ -std=c++14 -Wall -Werror file.cpp
g++ -std=c++17 -Wall -Werror file.cpp
g++ -std=c++20 -Wall -Werror file.cpp
```

## C Language Standards

### C89/C90 → C99 Migration
**Major Additions**:
- `//` single-line comments
- Variable-length arrays (VLAs)
- `inline` functions
- `restrict` keyword
- Complex number support
- Designated initializers

### C99 → C11 Migration
**Major Additions**:
- `_Static_assert`
- `_Generic` expressions
- Thread support library
- `_Alignas` and `_Alignof`
- Anonymous structures and unions

### C11 → C17/C18 Migration
**Changes**:
- Primarily bug fixes and clarifications
- No major new features

**Verification Patterns**:
```bash
gcc -std=c89 -Wall -Werror file.c
gcc -std=c99 -Wall -Werror file.c
gcc -std=c11 -Wall -Werror file.c
```

## C# Language Versions

### C# 6.0 → C# 7.0 Migration
**Major Additions**:
- Tuples and deconstruction
- Pattern matching
- Local functions
- `out` variables
- Throw expressions

### C# 7.0 → C# 8.0 Migration
**Major Additions**:
- Nullable reference types
- Async streams
- Pattern matching enhancements
- Switch expressions
- Default interface methods

### C# 8.0 → C# 9.0 Migration
**Major Additions**:
- Records
- Init-only properties
- Top-level programs
- Pattern matching improvements
- Target-typed new expressions

### C# 9.0 → C# 10.0 Migration
**Major Additions**:
- Global using directives
- File-scoped namespaces
- Record structs
- Constant interpolated strings

**Verification Patterns**:
```xml
<PropertyGroup>
  <LangVersion>6.0</LangVersion>
  <LangVersion>7.0</LangVersion>
  <LangVersion>8.0</LangVersion>
  <LangVersion>9.0</LangVersion>
  <LangVersion>10.0</LangVersion>
</PropertyGroup>
```

## Java Language Versions

### Java 8 → Java 11 Migration
**Major Changes**:
- Lambda expressions and streams (Java 8)
- Module system (Java 9)
- Local variable type inference (`var`) (Java 10)
- String and collection enhancements (Java 11)

**Compatibility Issues**:
- Removed features: Java EE modules, CORBA
- Security manager changes
- Garbage collector changes

### Java 11 → Java 17 Migration
**Major Changes**:
- Text blocks (Java 13)
- Switch expressions (Java 14)
- Records (Java 14)
- Pattern matching for instanceof (Java 16)
- Sealed classes (Java 17)

### Java 17 → Java 21 Migration
**Major Changes**:
- Pattern matching for switch (Java 21)
- Virtual threads (Java 21)
- Sequenced collections (Java 21)

**Verification Patterns**:
```bash
javac --release 8 MyClass.java
javac --release 11 MyClass.java
javac --release 17 MyClass.java
javac --release 21 MyClass.java
```

## Python 3 Versions

### Python 3.6 → Python 3.7 Migration
**Major Additions**:
- Data classes
- Guaranteed dict ordering
- Context variables
- Postponed evaluation of annotations

### Python 3.7 → Python 3.8 Migration
**Major Additions**:
- Walrus operator (`:=`)
- Positional-only parameters
- f-string improvements
- `typing.TypedDict`

### Python 3.8 → Python 3.9 Migration
**Major Additions**:
- Dictionary merge operators (`|`, `|=`)
- Type hinting generics
- String methods (`removeprefix`, `removesuffix`)

### Python 3.9 → Python 3.10 Migration
**Major Additions**:
- Structural pattern matching
- Union types (`X | Y`)
- Parameter specification variables

### Python 3.10 → Python 3.11 Migration
**Major Additions**:
- Exception groups
- `tomllib` module
- Fine-grained error locations

**Verification Patterns**:
```bash
python3.6 -m py_compile script.py
python3.7 -m py_compile script.py
python3.8 -m py_compile script.py
python3.9 -m py_compile script.py
python3.10 -m py_compile script.py
python3.11 -m py_compile script.py
```

## JavaScript/ECMAScript Versions

### ES5 → ES6/ES2015 Migration
**Major Additions**:
- Arrow functions
- Classes
- Template literals
- Destructuring
- `let` and `const`
- Modules
- Promises

### ES6 → ES2017 Migration
**Major Additions**:
- Async/await (ES2017)
- Object.entries/Object.values (ES2017)
- String padding (ES2017)
- Exponentiation operator (`**`) (ES2016)

### ES2017 → ES2020 Migration
**Major Additions**:
- Optional chaining (`?.`)
- Nullish coalescing (`??`)
- BigInt
- Dynamic imports
- `Promise.allSettled`

### ES2020 → ES2023 Migration
**Major Additions**:
- Top-level await (ES2022)
- Private class fields (ES2022)
- Array.findLast (ES2023)
- Hashbang grammar (ES2023)

**Verification Patterns**:
```json
{
  "browserslist": [
    "last 2 versions",
    "> 1%",
    "IE 11"
  ]
}
```

## TypeScript Versions

### TypeScript 3.x → 4.x Migration
**Major Changes**:
- Variadic tuple types
- Template literal types
- Conditional types improvements
- `unknown` type refinements

### TypeScript 4.x → 5.x Migration
**Major Changes**:
- Decorators support
- `const` type parameters
- Multiple config files support
- Bundle size optimizations

**Compatibility Issues**:
- Stricter type checking in newer versions
- Breaking changes in type inference
- Node.js version requirements

**Verification Patterns**:
```json
{
  "compilerOptions": {
    "target": "ES5",
    "target": "ES2015",
    "target": "ES2020",
    "strict": true
  }
}
```

## Ruby Versions

### Ruby 2.7 → Ruby 3.0 Migration
**Major Changes**:
- Positional and keyword argument separation
- Pattern matching
- Ractor (experimental)
- Type definitions (RBS)

### Ruby 3.0 → Ruby 3.1 Migration
**Major Changes**:
- YJIT compiler
- Pattern matching improvements
- Hash shorthand syntax

### Ruby 3.1 → Ruby 3.2 Migration
**Major Changes**:
- WASI support
- Anonymous rest and keyword rest arguments
- Data class

**Verification Patterns**:
```bash
ruby -v
rbenv install 2.7.0
rbenv install 3.0.0
rbenv install 3.1.0
rbenv install 3.2.0
```

## Scala Versions

### Scala 2.12 → Scala 2.13 Migration
**Major Changes**:
- Collections library redesign
- Literal types
- Partial unification enabled by default

### Scala 2.13 → Scala 3.0 Migration
**Major Changes**:
- New syntax (optional braces, significant indentation)
- Union and intersection types
- Enums
- Extension methods
- Metaprogramming with macros 3.0

**Compatibility Issues**:
- Source incompatibility between Scala 2 and 3
- Binary compatibility concerns
- Migration tools required

**Verification Patterns**:
```scala
// build.sbt
scalaVersion := "2.12.17"
scalaVersion := "2.13.10"
scalaVersion := "3.2.2"
```

## React Versions

### React 15 → React 16 Migration
**Major Changes**:
- Fiber reconciler
- Error boundaries
- Fragments
- Portals
- Context API improvements

### React 16 → React 17 Migration
**Major Changes**:
- No new features (preparation for React 18)
- Event delegation changes
- New JSX transform

### React 17 → React 18 Migration
**Major Changes**:
- Concurrent features
- Automatic batching
- Suspense improvements
- New hooks (`useId`, `useDeferredValue`, `useTransition`)
- Strict mode changes

**Compatibility Issues**:
- Breaking changes in event handling
- Concurrent rendering behavior changes
- StrictMode double-rendering in development

**Verification Patterns**:
```json
{
  "dependencies": {
    "react": "^16.14.0",
    "react": "^17.0.2",
    "react": "^18.2.0"
  }
}
```

## General Compatibility Strategies

### Version Testing
1. **Automated Testing**: Set up CI/CD with multiple language versions
2. **Feature Detection**: Use feature detection instead of version detection
3. **Polyfills**: Use polyfills for missing features in older versions
4. **Transpilation**: Use tools like Babel, TypeScript compiler for backward compatibility

### Migration Best Practices
1. **Incremental Migration**: Migrate gradually, not all at once
2. **Compatibility Layers**: Maintain compatibility layers during transition
3. **Documentation**: Document breaking changes and migration paths
4. **Testing**: Comprehensive testing across target versions
5. **Deprecation Warnings**: Use deprecation warnings before removing features

### Common Patterns
- **Feature Flags**: Toggle new features based on environment
- **Adapter Pattern**: Create adapters for different API versions
- **Version Detection**: Runtime detection of language/framework versions
- **Graceful Degradation**: Provide fallbacks for unsupported features

## Go Language Versions

### Go 1.11 → Go 1.13 Migration
**Major Additions**:
- Go modules (Go 1.11)
- Error wrapping with `fmt.Errorf` (Go 1.13)
- Number literals improvements (Go 1.13)

### Go 1.13 → Go 1.16 Migration
**Major Additions**:
- Embedded files with `embed` package (Go 1.16)
- `io/fs` package (Go 1.16)
- Module retraction (Go 1.16)
- `//go:build` constraints (Go 1.17)

### Go 1.16 → Go 1.18 Migration
**Major Additions**:
- Generics/Type parameters
- Fuzzing support
- Workspace mode
- `any` and `comparable` built-in types

### Go 1.18 → Go 1.21 Migration
**Major Additions**:
- `slices` and `maps` packages (Go 1.21)
- `min` and `max` built-in functions (Go 1.21)
- `clear` built-in function (Go 1.21)
- Profile-guided optimization (Go 1.20)

**Compatibility Issues**:
- GOPATH vs Go modules transition
- Generics syntax changes
- Build constraint syntax evolution

**Verification Patterns**:
```bash
go version
go mod init myproject
go build -tags=go1.16
go build -tags=go1.18
```

## Rust Language Versions

### Rust 2015 → Rust 2018 Migration
**Major Changes**:
- Non-lexical lifetimes
- Module system improvements
- `dyn Trait` syntax
- Raw identifiers (`r#`)
- `?` operator in `main` and tests

### Rust 2018 → Rust 2021 Migration
**Major Changes**:
- Disjoint captures in closures
- IntoIterator for arrays
- Panic macro consistency
- Reserving syntax for future use

### Edition-Independent Features
**Rust 1.39 → 1.45**:
- `async`/`await` syntax stabilization
- `matches!` macro
- `std::future::Future`

**Rust 1.45 → 1.56**:
- `const` generics
- Edition 2021 features
- Cargo resolver v2

**Rust 1.56 → 1.70**:
- Generic associated types (GATs)
- `let-else` statements
- C-compatible FFI improvements

**Compatibility Issues**:
- Edition migration required for some features
- Lifetime elision rule changes
- Macro hygiene improvements

**Verification Patterns**:
```toml
# Cargo.toml
[package]
edition = "2015"
edition = "2018"
edition = "2021"

# Check compatibility
cargo check --edition 2021
```

## Kotlin Language Versions

### Kotlin 1.3 → Kotlin 1.4 Migration
**Major Additions**:
- Coroutines stable
- Multiplatform mobile alpha
- New IR backend
- SAM conversions for Kotlin interfaces

### Kotlin 1.4 → Kotlin 1.5 Migration
**Major Additions**:
- Stable IR backend
- Inline classes stable
- JVM records support
- Sealed interfaces

### Kotlin 1.5 → Kotlin 1.7 Migration
**Major Additions**:
- Context receivers (experimental)
- Definitely non-nullable types
- Builder inference improvements
- Kotlin/Native memory manager

### Kotlin 1.7 → Kotlin 1.9 Migration
**Major Additions**:
- Data object declarations
- Secondary constructors with bodies in enum entries
- Kotlin Multiplatform stable
- New Kotlin/Wasm target

**Compatibility Issues**:
- IR backend migration
- Coroutines API evolution
- Multiplatform target changes

**Verification Patterns**:
```kotlin
// build.gradle.kts
kotlin {
    jvmToolchain(8)
    jvmToolchain(11)
    jvmToolchain(17)
}

compilerOptions {
    languageVersion.set(KotlinVersion.KOTLIN_1_8)
    apiVersion.set(KotlinVersion.KOTLIN_1_8)
}
```

## PHP Language Versions

### PHP 7.4 → PHP 8.0 Migration
**Major Changes**:
- Just-In-Time compilation (JIT)
- Named arguments
- Union types
- Match expressions
- Constructor property promotion
- Nullsafe operator (`?->`)

### PHP 8.0 → PHP 8.1 Migration
**Major Changes**:
- Enumerations
- Readonly properties
- Intersection types
- Fibers
- `never` return type

### PHP 8.1 → PHP 8.2 Migration
**Major Changes**:
- Readonly classes
- Disjunctive Normal Form (DNF) types
- `true`, `false`, `null` as standalone types
- New `random` extension

### PHP 8.2 → PHP 8.3 Migration
**Major Changes**:
- Typed class constants
- Dynamic class constant fetch
- `#[Override]` attribute
- JSON validation improvements

**Compatibility Issues**:
- Breaking changes in each major version
- Deprecated function removals
- Type system strictness increases

**Verification Patterns**:
```bash
php -v
composer require --dev phpstan/phpstan
phpstan analyse --level 8 src/
```

## Swift Language Versions

### Swift 4.2 → Swift 5.0 Migration
**Major Changes**:
- ABI stability
- String literals as raw strings
- Result type
- `@dynamicCallable` attribute

### Swift 5.0 → Swift 5.5 Migration
**Major Changes**:
- Async/await concurrency
- Actors
- Structured concurrency
- `@main` attribute

### Swift 5.5 → Swift 5.7 Migration
**Major Changes**:
- Distributed actors
- Regex literals
- Generic protocols (`any` and `some`)
- Multi-statement closure type inference

### Swift 5.7 → Swift 5.9 Migration
**Major Changes**:
- Macros
- `if` and `switch` expressions
- Parameter packs
- Ownership features

**Compatibility Issues**:
- ABI stability requirements
- Concurrency model adoption
- iOS deployment target changes

**Verification Patterns**:
```swift
// Package.swift
// swift-tools-version:5.5
// swift-tools-version:5.7
// swift-tools-version:5.9

import PackageDescription
```

## Dart Language Versions

### Dart 2.7 → Dart 2.12 Migration
**Major Changes**:
- Null safety (sound null safety)
- Late variables
- Required named parameters
- Extension methods stable

### Dart 2.12 → Dart 2.17 Migration
**Major Changes**:
- Enhanced enums
- Super parameters
- Named arguments everywhere
- Callable objects

### Dart 2.17 → Dart 3.0 Migration
**Major Changes**:
- Records and patterns
- Class modifiers (`sealed`, `base`, `interface`)
- Switch expressions
- 100% null safety

**Compatibility Issues**:
- Null safety migration required
- Breaking changes in Dart 3.0
- Flutter SDK compatibility

**Verification Patterns**:
```yaml
# pubspec.yaml
environment:
  sdk: '>=2.12.0 <3.0.0'
  sdk: '>=2.17.0 <4.0.0'
  sdk: '>=3.0.0 <4.0.0'
```

## Vue.js Framework Versions

### Vue 2 → Vue 3 Migration
**Major Changes**:
- Composition API
- Multiple root elements
- Teleport component
- Fragments support
- Better TypeScript support
- Performance improvements

**Breaking Changes**:
- Global API changes
- Template directive changes
- Component lifecycle changes
- Event API changes

### Vue 3.0 → Vue 3.3 Migration
**Major Additions**:
- `<script setup>` improvements
- Generic components
- Better TypeScript support
- Suspense stable

**Compatibility Issues**:
- Vue 2 plugins incompatibility
- Different reactivity system
- Build tool requirements

**Verification Patterns**:
```json
{
  "dependencies": {
    "vue": "^2.7.0",
    "vue": "^3.3.0"
  },
  "devDependencies": {
    "@vue/compat": "^3.3.0"
  }
}
```

## Angular Framework Versions

### Angular 12 → Angular 14 Migration
**Major Changes**:
- Ivy renderer default (Angular 12)
- Standalone components (Angular 14)
- Angular CLI auto-completion
- Strict mode by default

### Angular 14 → Angular 16 Migration
**Major Changes**:
- Signals (developer preview)
- Required inputs
- Router data as input
- Non-destructive hydration

### Angular 16 → Angular 17 Migration
**Major Changes**:
- New control flow syntax (`@if`, `@for`)
- New lifecycle hooks
- Material Design Components (MDC)
- New Angular brand

**Compatibility Issues**:
- AngularJS to Angular migration
- Breaking changes in major versions
- Dependency injection changes

**Verification Patterns**:
```bash
ng update @angular/core @angular/cli
ng update --all
npx @angular/cli@latest new my-app
```

## Node.js Runtime Versions

### Node.js 14 → Node.js 16 Migration
**Major Changes**:
- V8 9.0 engine
- npm 7 by default
- Apple Silicon support
- AbortController global
- Timers Promises API

### Node.js 16 → Node.js 18 Migration
**Major Changes**:
- V8 10.1 engine
- Fetch API global
- Web Streams API
- Test runner built-in
- OpenSSL 3.0

### Node.js 18 → Node.js 20 Migration
**Major Changes**:
- V8 11.3 engine
- Permissions model
- Custom ESM loader hooks
- Stable test runner

**Compatibility Issues**:
- OpenSSL version changes
- V8 engine updates
- npm version differences
- ES modules vs CommonJS

**Verification Patterns**:
```json
{
  "engines": {
    "node": ">=14.0.0",
    "node": ">=16.0.0",
    "node": ">=18.0.0",
    "npm": ">=7.0.0"
  }
}
```

## Express.js Framework Versions

### Express 4 → Express 5 Migration
**Major Changes**:
- Promises support
- Improved error handling
- Router improvements
- Path-to-regexp updates
- Removed deprecated features

**Breaking Changes**:
- `app.del()` removed
- `req.host` behavior change
- `res.json()` and `res.jsonp()` changes
- Query parser changes

**Compatibility Issues**:
- Middleware compatibility
- Route handler changes
- Error handling differences

**Verification Patterns**:
```javascript
// Check Express version
const express = require('express');
console.log(express.version);

// Package.json
{
  "dependencies": {
    "express": "^4.18.0",
    "express": "^5.0.0-beta.1"
  }
}
```

## Database Compatibility

### PostgreSQL Versions

#### PostgreSQL 12 → PostgreSQL 14 Migration
**Major Features**:
- Generated columns (PostgreSQL 12)
- B-tree deduplication (PostgreSQL 13)
- Multirange types (PostgreSQL 14)
- Stored procedures with transactions

#### PostgreSQL 14 → PostgreSQL 15 Migration
**Major Features**:
- `MERGE` command
- Row-level security improvements
- Logical replication improvements
- Performance enhancements

**Verification Patterns**:
```sql
SELECT version();
SHOW server_version;
```

### MySQL Versions

#### MySQL 5.7 → MySQL 8.0 Migration
**Major Changes**:
- Common Table Expressions (CTEs)
- Window functions
- JSON improvements
- Invisible indexes
- Descending indexes

**Breaking Changes**:
- Default authentication plugin change
- SQL mode changes
- Reserved keywords additions

**Verification Patterns**:
```sql
SELECT VERSION();
SHOW VARIABLES LIKE 'version%';
```

### MongoDB Versions

#### MongoDB 4.4 → MongoDB 5.0 Migration
**Major Features**:
- Time series collections
- Clustered collections
- Live resharding
- Versioned API

#### MongoDB 5.0 → MongoDB 6.0 Migration
**Major Features**:
- Queryable encryption
- Cluster-to-cluster sync
- Time series improvements

**Verification Patterns**:
```javascript
db.version()
db.runCommand({buildInfo: 1})
```

## Web Framework Compatibility

### Django Framework Versions

#### Django 3.2 → Django 4.0 Migration
**Major Changes**:
- `zoneinfo` default timezone implementation
- Functional indexes
- `scream` cache key validation
- Template-based form rendering

#### Django 4.0 → Django 4.2 Migration
**Major Changes**:
- Psycopg 3 support
- Comments on columns and tables
- Mitigation for Breach attack
- Custom file storages

**Compatibility Issues**:
- Python version requirements
- Database backend changes
- Third-party package compatibility

**Verification Patterns**:
```python
import django
print(django.VERSION)

# settings.py
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'OPTIONS': {
            'server_side_binding': True,  # Django 4.2+
        },
    }
}
```

### Flask Framework Versions

#### Flask 1.1 → Flask 2.0 Migration
**Major Changes**:
- Async support
- Nested blueprints
- `click` 8.0 support
- JSON provider interface

#### Flask 2.0 → Flask 2.3 Migration
**Major Changes**:
- Type hints improvements
- Better error handling
- Security improvements

**Compatibility Issues**:
- Python version requirements
- Extension compatibility
- Werkzeug version dependencies

**Verification Patterns**:
```python
import flask
print(flask.__version__)

# requirements.txt
Flask>=2.0.0,<3.0.0
Werkzeug>=2.0.0
```

### Spring Boot Framework Versions

#### Spring Boot 2.6 → Spring Boot 2.7 Migration
**Major Changes**:
- Auto-configuration for Spring GraphQL
- Podman support
- RSocket support improvements

#### Spring Boot 2.7 → Spring Boot 3.0 Migration
**Major Changes**:
- Java 17 baseline
- Jakarta EE 9 baseline
- Spring Framework 6
- Native compilation support
- Observability improvements

**Breaking Changes**:
- Java EE to Jakarta EE migration
- Configuration property changes
- Actuator endpoint changes

**Verification Patterns**:
```xml
<!-- pom.xml -->
<parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>2.7.0</version>
    <version>3.0.0</version>
</parent>
```

### .NET Framework Versions

#### .NET Framework → .NET Core Migration
**Major Changes**:
- Cross-platform support
- Performance improvements
- Modular architecture
- Side-by-side deployment

#### .NET Core 3.1 → .NET 5 Migration
**Major Changes**:
- Single .NET going forward
- C# 9 and F# 5
- Performance improvements
- ARM64 support

#### .NET 5 → .NET 6 Migration
**Major Changes**:
- Hot reload
- Minimal APIs
- Global using directives
- File-scoped namespaces

#### .NET 6 → .NET 8 Migration
**Major Changes**:
- Native AOT improvements
- Blazor improvements
- Performance enhancements
- Cloud-native features

**Compatibility Issues**:
- Target framework changes
- Package reference updates
- API surface changes

**Verification Patterns**:
```xml
<PropertyGroup>
    <TargetFramework>net48</TargetFramework>
    <TargetFramework>netcoreapp3.1</TargetFramework>
    <TargetFramework>net5.0</TargetFramework>
    <TargetFramework>net6.0</TargetFramework>
    <TargetFramework>net8.0</TargetFramework>
</PropertyGroup>
```

## Container and Orchestration Compatibility

### Docker Versions
**Docker 19.03 → Docker 20.10**:
- BuildKit default
- `docker scan` command
- Rootless mode improvements

**Docker 20.10 → Docker 24.0**:
- Compose V2 default
- BuildKit improvements
- Security enhancements

### Kubernetes Versions
**Kubernetes 1.20 → 1.25**:
- Dockershim removal
- Pod Security Standards
- Ephemeral containers stable

**Kubernetes 1.25 → 1.28**:
- Sidecar containers
- Job completion mode
- ValidatingAdmissionPolicy

**Verification Patterns**:
```bash
docker version
kubectl version --client
kubectl version --short
```
