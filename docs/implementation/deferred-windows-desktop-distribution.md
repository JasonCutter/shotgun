# Shotgun Windows Desktop Distribution — 구현 예정

> 상태: **DEFERRED / IMPLEMENTATION PLANNED**  
> 우선순위: **Project Shotgun 최종 단계**  
> 작성일: 2026-08-13  
> 구현 시작 시점: 미정 — Shotgun 본체 기능과 실사용 검증이 완료된 뒤 활성화

## 1. 결정

Shotgun의 최종 실사용 형태는 브라우저 탭에서 사용하는 로컬 웹 앱이 아니라 **독립 Windows 데스크톱 프로그램**으로 제공한다.

현재 개발·검증 단계의 Docker Desktop, PowerShell, `npm run launch`, 브라우저 접속 방식은 개발용 실행 경로로 유지하되, 최종 사용자 경험으로 채택하지 않는다.

이 작업은 현재 진행 중인 기능 구현에 끼워 넣지 않고 **Project Shotgun의 맨 마지막 배포·제품화 단계**에서 수행한다.

## 2. 목표 사용자 경험

최종 목표는 다음 흐름이다.

```text
ShotgunSetup.exe 또는 동등한 설치 패키지
        ↓
설치
        ↓
바탕화면 / 시작 메뉴의 Shotgun 아이콘
        ↓
더블클릭
        ↓
필요한 로컬 Runtime과 DB 자동 기동
        ↓
브라우저 주소창이 없는 Shotgun 독립창 표시
        ↓
사용
        ↓
창 종료 시 필요한 프로세스 안전 종료
```

사용자는 정상 사용을 위해 Docker Desktop, PowerShell, npm, Node.js 명령을 직접 실행하거나 관리하지 않아야 한다.

## 3. 구현 범위

최종 단계에서는 최소한 다음을 해결한다.

- Windows 독립 애플리케이션 창 제공
- 기존 Shotgun Frontend UX를 독립창에서 제공
- Shotgun Backend 자동 시작·상태 확인·종료
- 로컬 데이터베이스 자동 시작·상태 확인·종료 또는 동등한 사용자 비노출 Runtime 구성
- 기존 Project, Knowledge, Settings, History의 재시작 후 지속성
- AI Provider API Key와 Credential Master Key의 안전한 로컬 보관
- DB migration의 안전한 자동 확인·적용
- 중복 실행 및 포트 충돌 처리
- 비정상 종료 후 복구 가능한 실행 모델
- 백업·복구 경로
- 설치·제거·업데이트 전략
- Windows 작업표시줄/시작 메뉴/바탕화면에서 독립 프로그램으로 식별되는 패키징

## 4. 현재 확정하지 않는 기술

이 문서는 제품 목표와 구현 예정 범위를 기록하는 문서이며 다음 기술 선택은 아직 확정하지 않는다.

- Tauri, Electron 또는 다른 Desktop Shell
- PostgreSQL을 번들·서비스·외부 프로세스 중 어떤 방식으로 관리할지
- Windows Credential Manager, DPAPI 또는 다른 OS 보안 저장소 사용 방식
- Installer 기술
- 자동 업데이트 기술
- 프로세스 supervisor 방식

구체 기술 선택은 이 단계가 실제로 시작될 때 당시 Shotgun Architecture와 OSS 상태를 다시 평가하고 필요한 ADR로 확정한다.

## 5. 금지되는 축소 해석

다음은 이 계획의 완료로 간주하지 않는다.

- 단순히 `npm run launch`를 실행하는 `.bat` 또는 `.exe` wrapper
- Docker Desktop을 사용자가 별도로 설치·실행해야 하는 상태
- PowerShell 명령 입력이 정상 사용 절차에 포함되는 상태
- Chrome/Edge의 일반 브라우저 탭을 최종 Shotgun UI로 사용하는 상태
- 데이터·API Key·설정이 재시작 후 유지되지 않는 패키지

## 6. 활성화 조건

이 작업은 다음 조건이 충족된 뒤 별도 Final Stage로 활성화한다.

1. Shotgun 본체의 핵심 Product 기능 구현과 검증이 완료되어 있을 것
2. Runtime-selectable AI Settings를 포함한 실제 사용 경로가 안정화되어 있을 것
3. Desktop Packaging 작업 때문에 진행 중인 Product 기능 범위를 다시 열 필요가 없을 것
4. 사용자가 실사용 배포 단계 진입을 승인할 것

활성화 시 별도의 상세 설계, OSS Evaluation, ADR, 구현 계획, Acceptance Criteria를 작성한다.

## 7. 현재 범위와의 관계

현재 A9 및 그 이전 AI Runtime 작업의 범위에는 이 Desktop Distribution 구현을 포함하지 않는다.

이 문서는 **잊지 않기 위한 구현 예정 기록**이며, 지금 당장 구현을 시작하라는 승인으로 해석하지 않는다.

## 8. 최종 완료 상태의 정의

최종적으로 사용자가 기대하는 상태는 다음 한 문장으로 정의한다.

> **Shotgun 아이콘을 더블클릭하면 독립 Shotgun 창이 열리고, 사용자는 Docker·PowerShell·npm·브라우저를 의식하지 않은 채 기존 데이터와 설정을 그대로 사용한다.**
