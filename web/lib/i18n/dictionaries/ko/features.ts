import type { FeaturesDict } from "../types";

export const features: FeaturesDict = {
  title: "Codewhale 기능 확인",
  description: "Codewhale 명령, 도구, Runtime 기능의 지원 상태와 문서를 확인하세요.",
  notice: "이 목록은 소스 v{version}의 {count}개 항목을 포함합니다. 이름과 설명은 영어이며, 설치된 버전을 확인하세요.",
  stable: "안정",
  flagged: "플래그 필요",
  experimental: "실험적",
  partial: "일부 지원",
  preview: "미리 보기",
  none: "사용 불가",
  docs: "문서 읽기",
  source: "소스 항목 보기",
  exportJson: "기능 JSON 다운로드",
};
