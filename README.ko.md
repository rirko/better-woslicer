# woslicer-dx

[English](README.md) · [中文](README.zh-CN.md) · [日本語](README.ja.md) · **한국어**

wosderge의 woslicerIII를 기반으로 만든 BMS용 오프라인 오디오 슬라이서입니다.

![메인 화면](docs/screenshots/main-ui.png)

## 기능

- WAV 및 OGG 가져오기와 WAV 슬라이스 내보내기. 음원 정보에 원본 형식을 표시하며, 현재 오디오 처리와 WAV 출력은 16-bit PCM을 사용합니다.
- `.wosdx` 프로젝트를 저장하고 다시 엽니다. 기존 `.wos` 설정을 가져오거나 내보냅니다. 클립보드로 BMSE와 컷 위치를 교환합니다.
- 스냅, 범위 선택, 퀀타이즈, 실행 취소/다시 실행을 지원하는 타임라인 편집.
- 배속 모니터링, 큐 사운드, 탭 보정.
- 주파수 대역 표시와 자동 컷 감지.
- 내장 BMHelper는 건반음 MIDI 파트를 녹음 시퀀스와 WAVE 정의로 분할합니다. 분할한 컷 위치를 타임라인에 적용할 수 있습니다.
- 원본 BMHelper beta 4′의 `.bmh` 파일을 읽고 저장합니다. DX 프로젝트는 Unicode 분할 이름을 보존합니다. BMH 내보내기는 원본의 CP932 문자 대체 규칙을 적용하고 이름이 바뀌면 경고를 표시합니다.
- 영어·중국어·일본어·한국어 UI. “About”에 버전, 커밋, 빌드 날짜를 표시.

## 실행

Releases(사전 릴리스) 또는 Actions 아티팩트에서 시스템에 맞는 패키지를 내려받습니다.

| 플랫폼 | 형식 | 사용 방법 |
| --- | --- | --- |
| Windows | .zip | ZIP을 풀고 앱을 실행합니다. WebView2가 필요합니다 |
| Linux | .deb / .AppImage | deb 설치 또는 AppImage 실행 |
| macOS | .dmg | 디스크 이미지를 열고 앱을 응용 프로그램 폴더로 드래그 |
| Web | .zip | 압축을 풀고 정적 웹사이트로 호스팅 |

Windows x64가 기본 데스크톱 버전입니다. 다른 Windows 아키텍처와 Linux 및 macOS 패키지는 제공 가능한 경우 포함됩니다. 앱은 파일을 로컬에서 처리하며 오프라인으로 동작합니다.

웹 버전은 브라우저에서 직접 실행됩니다: [woslicer-dx app](https://woslicer-dx.pages.dev/) (설치 불필요).

## 조작

데스크톱 프로젝트는 오디오의 절대 경로를 저장하고 열 때 사용 가능한 파일을 자동으로 다시 연결합니다. 파일을 이동한 경우 “오디오 다시 연결”을 사용하세요. 브라우저에서는 직접 다시 연결해야 합니다. 세션 복원이나 오디오 로딩 중에는 작업 영역 상단에 현재 단계를 표시합니다.

| 키 | 동작 |
| --- | --- |
| Space | 재생 / 일시정지 |
| Enter / `,` / `.` | 재생 헤드 또는 커서 위치에 컷 추가 |
| Z | 커서 위치의 컷 전환 |
| 방향키 | 그리드 / 마디 단위로 이동. Shift+좌우는 1 tick |
| P / O | 현재 / 이전 슬라이스 미리 듣기 |
| Q / W | 그리드 밀도 줄이기 / 늘리기 |
| `[` / `]` | 모니터링 속도 낮추기 / 높이기 |
| Ctrl+C / X / V | 선택한 마커 복사 / 잘라내기 / 붙여넣기 |
| Ctrl+Z / Ctrl+Shift+Z | 실행 취소 / 다시 실행 |
| M | 모든 슬라이스 내보내기 |
| Ctrl+O / Ctrl+Shift+O / Ctrl+S | 오디오 열기 / `.wosdx` 프로젝트 열기 / 프로젝트 저장 |
| T / Y | `.wos` 설정 가져오기 / 내보내기 |
| V / B | BMSE 클립보드 쓰기 / 읽기 |

- 왼쪽 버튼으로 드래그하면 컷을 추가합니다.
- 오른쪽 버튼으로 드래그하면 컷을 지웁니다.
- Shift 또는 Ctrl을 누른 상태로 드래그하면 범위를 선택합니다.
- 컷을 드래그하면 선택 영역을 이동합니다.
- Ctrl+휠로 확대하거나 축소합니다.
- 가운데 버튼으로 드래그하면 표시 범위를 이동합니다.
- Alt를 누르는 동안 스냅을 해제합니다.

## 프로젝트 정보

[변경 로그](CHANGELOG.md) · [개발 가이드(영어)](docs/DEVELOPMENT.md)

## 라이선스와 크레딧

원본 woslicer II/III: [wosderge](https://cerebralmuddystream.nekokan.dyndns.info/). 기여자가 권리를 가진 부분은 [MIT](LICENSE)이며, 원본에서 파생된 부분과 서드파티 의존성은 이 허여에 포함되지 않습니다. 범위와 저작자 표시는 [NOTICE](NOTICE)를 참고하세요.

내장 BMHelper는 [exclusion](https://excln.github.io/)이 공개한 소스 코드를 바탕으로 Be-Music Helper(beta 4′)의 동작을 재구현했습니다. 원본 README는 금전이 오가지 않고 원작자를 명시하는 조건으로 2차 사용을 허용합니다. [원본 BMHelper](https://excln.github.io/bmhelper.html) · [NOTICE](NOTICE)

파형 디자인 스타일 참고: [Audacity](https://www.audacityteam.org/).
