/**
 * 행정법 OX 문항 (공개 기출·교재의 전형적 쟁점을 학습용으로 재구성)
 * answer: true = O(참), false = X(거짓)
 * examId: exam-catalog.js 시험 id, year: 시행 연도(출처·필터에 사용, 예: 2026년도 국가직 9급)
 * exam: 선택, 카탈로그에 없을 때 출처 시험명 폴백용
 * importance·difficulty: 1~5 (표시용 별 개수)
 * explanationBasic·detail·tags: 확장 해설(없으면 explanation만 사용)
 */
window.QUESTION_BANK = [
  {
    id: "q-ex-defendant-transfer",
    examId: "lawyer",
    year: 2025,
    exam: "변호사·5급 공통 유형",
    topic: "행정소송",
    statement:
      "A행정청이 과징금을 부과한 후 권한이 B행정청으로 승계된 상황에서, 상대방이 취소소송을 제기할 때 피고는 원래 처분을 했던 A행정청이 되어야 한다.",
    answer: false,
    importance: 5,
    difficulty: 2,
    explanation:
      "행정권한이 승계되었다면 현재 그 권한을 보유한 승계 행정청이 피고가 됩니다.",
    explanationBasic:
      "행정권한이 승계되었다면 현재 그 권한을 보유한 승계 행정청이 피고가 됩니다.",
    detail: {
      legal:
        "행정소송법 제13조 제1항 단서에 따르면, 처분 후에 그 처분에 관계되는 권한이 다른 행정청에 승계된 때에는 그 권한을 승계한 행정청을 피고로 합니다.",
      trap:
        "출제자는 주로 '처분 시의 행정청'을 피고로 해야 한다는 식으로 수험생을 낚습니다.",
      precedent:
        "행정처분 취소소송의 피고는 원칙적으로 그 처분을 행한 행정청이나, 권한 승계 시에는 예외적으로 승계 행정청이 피고적격을 가집니다."
    },
    tags: ["피고적격", "권한승계", "행정소송법제13조", "과징금"]
  },
  {
    id: "q1",
    examId: "grade5",
    year: 2025,
    exam: "5급·일반",
    topic: "행정법 일반",
    statement: "행정법상 법률유보의 원칙은 행정권의 작용에 관하여 법률이 정한 범위 안에서만 행정작용이 가능하다는 것을 의미한다.",
    answer: true,
    explanation: "법률유보는 행정작용의 근거·내용·한계를 법률에 두어야 한다는 원칙으로 이해할 수 있다."
  },
  {
    id: "q2",
    examId: "grade9",
    year: 2025,
    exam: "7급·9급",
    topic: "행정법 일반",
    statement: "법치행정 원칙은 행정이 법에 구속될 뿐 아니라 실질적 정당성까지 요구한다는 측면도 포함할 수 있다.",
    answer: true,
    explanation: "전통적 법치행정에 더해 목적·수단의 균형, 비례원칙 등 실질적 정당성 논의가 결합된다."
  },
  {
    id: "q3",
    examId: "lawyer",
    year: 2025,
    exam: "변호사",
    topic: "행정행위",
    statement: "행정행위는 반드시 서면으로 하여야 하며, 구두로는 할 수 없다.",
    answer: false,
    explanation: "형식은 법령·행위성질에 따라 달라지며, 구두행위도 가능한 경우가 있다(예: 구두로 한 단순한 거절 등, 다만 증명 문제는 별도)."
  },
  {
    id: "q4",
    examId: "grade5",
    year: 2024,
    exam: "5급·일반",
    topic: "행정행위",
    statement: "행정행위의 효력발생에 관하여는 특별한 규정이 없으면 상대방에게 도달한 때에 효력이 생긴다고 보는 견해가 일반적이다.",
    answer: true,
    explanation: "도달주의가 통설적 입장이다(행정행위법 등 특별규정이 있으면 그에 따름)."
  },
  {
    id: "q5",
    examId: "grade9",
    year: 2024,
    exam: "7급·9급",
    topic: "행정행위",
    statement: "부관은 행정행위의 효력을 제한·변경·소멸시키기 위하여 주된 내용에 붙이는 부가적 의제이다.",
    answer: true,
    explanation: "조건·기한·취소권유보 등이 대표적 부관이다."
  },
  {
    id: "q6",
    examId: "grade5",
    year: 2026,
    exam: "5급·일반",
    topic: "행정행위",
    statement: "행정행위의 취소와 철회는 항상 동일한 개념으로 쓰인다.",
    answer: false,
    explanation: "취소는 위법한 행위를 소급적으로 무효로 하는 제도, 철회는 적법행위를 소급적으로 효력을 없애는 제도로 구분된다(요건·제한이 다름)."
  },
  {
    id: "q7",
    examId: "lawyer",
    year: 2024,
    exam: "변호사",
    topic: "행정소송",
    statement: "취소소송에서 원고적격은 일반적으로 법령상 보호되는 이익이 침해된 자에게 인정된다.",
    answer: true,
    explanation: "보호규범이론·보호된 이익 개념이 원고적격 판단의 틀로 쓰인다."
  },
  {
    id: "q8",
    examId: "grade5",
    year: 2023,
    exam: "5급·일반",
    topic: "행정소송",
    statement: "항고소송에서 피고는 항상 국가만 될 수 있다.",
    answer: false,
    explanation: "항고소송의 피고는 처분 등을 한 행정청 등이 되며, 지방자치단체·공공단체 등이 될 수 있다."
  },
  {
    id: "q9",
    examId: "grade9",
    year: 2026,
    exam: "7급·9급",
    topic: "행정소송",
    statement: "무효확인소송은 처분 등이 객관적으로 명백히 무효인 경우에 그 확인을 구할 수 있는 소송유형이다.",
    answer: true,
    explanation: "명백한 무효에 대한 확인의 소(행정소송법상 제도)와 관련하여 기출에서 자주 다룬다."
  },
  {
    id: "q10",
    examId: "lawyer",
    year: 2026,
    exam: "변호사",
    topic: "행정소송",
    statement: "집행정지는 본안의 승패와 관계없이 당연히 집행이 정지된다는 뜻이다.",
    answer: false,
    explanation: "집행정지는 법원의 결정 등 요건을 갖추어야 하며, 당연정지와 구별된다."
  },
  {
    id: "q11",
    examId: "grade5",
    year: 2025,
    exam: "5급·일반",
    topic: "행정절차",
    statement: "행정절차법상 의견청취는 모든 행정청의 모든 처분에 반드시 적용된다.",
    answer: false,
    explanation: "적용 대상·예외(간이절차·긴급행위 등)가 법에 정해져 있어 일률적이지 않다."
  },
  {
    id: "q12",
    examId: "grade9",
    year: 2025,
    exam: "7급·9급",
    topic: "행정절차",
    statement: "청문은 이해관계인 등의 의견을 듣는 절차의 하나로, 의견청취보다 엄격한 요건·절차가 붙는 경우가 많다.",
    answer: true,
    explanation: "법령에서 청문을 요구하는 경우 공개·기일·조서 등 절차가 중시된다."
  },
  {
    id: "q13",
    examId: "grade5",
    year: 2024,
    exam: "5급·일반",
    topic: "국가배상",
    statement: "국가배상법상 공무원의 고의·과실이 없더라도 항상 국가가 책임을 진다.",
    answer: false,
    explanation: "일반적으로 공무원의 고의·과실 등 위법행위 책임 요건이 문제되며, 특별한 무과실책임 규정은 별도이다."
  },
  {
    id: "q14",
    examId: "lawyer",
    year: 2025,
    exam: "변호사",
    topic: "국가배상",
    statement: "국가배상책임은 원칙적으로 공무원의 직무상 불법행위로 인한 손해에 대하여 국가 또는 지방자치단체가 부담한다.",
    answer: true,
    explanation: "국가배상법의 기본 구조는 공무원 불법행위책임의 전환이다."
  },
  {
    id: "q15",
    examId: "grade9",
    year: 2024,
    exam: "7급·9급",
    topic: "행정계획",
    statement: "행정계획은 항상 개별적·구체적 법률효과를 직접 발생시키는 행정행위이다.",
    answer: false,
    explanation: "도시계획 등은 성질상 행정계획으로, 구속력·효과는 유형에 따라 다르다."
  },
  {
    id: "q16",
    examId: "grade5",
    year: 2026,
    exam: "5급·일반",
    topic: "행정입법",
    statement: "법률위임이 있어야 행정입법(명령·규칙)이 할 수 있는 영역이 생긴다는 점에서 위임받은 범위를 벗어난 입법은 위법할 수 있다.",
    answer: true,
    explanation: "법률유보·위임명확성 원칙과 연계하여 위반 시 무효·취소 사유가 될 수 있다."
  },
  {
    id: "q17",
    examId: "lawyer",
    year: 2023,
    exam: "변호사",
    topic: "행정강제",
    statement: "대체적 작위의 이행은 행정대집행의 한 유형으로 이해될 수 있다.",
    answer: true,
    explanation: "의무이행을 대신 시키고 비용을 징수하는 구조로 기출에서 행정강제와 함께 출제된다."
  },
  {
    id: "q18",
    examId: "grade9",
    year: 2023,
    exam: "7급·9급",
    topic: "조세·행정",
    statement: "조세법률주의에 따라 조세의 과세요건은 원칙적으로 법률로 정하여야 한다.",
    answer: true,
    explanation: "헌법과 조세법의 기본 원칙으로 자주 OX로 나온다."
  },
  {
    id: "q19",
    examId: "grade5",
    year: 2025,
    exam: "5급·일반",
    topic: "행정행위",
    statement: "확정력 있는 행정행위는 행정청도 임의로 변경할 수 없다는 원칙이 성립할 수 있다.",
    answer: true,
    explanation: "처분의 확정력과 일신불구속의 원칙이 관련된다."
  },
  {
    id: "q20",
    examId: "lawyer",
    year: 2024,
    exam: "변호사",
    topic: "행정소송",
    statement: "당사자소송은 공법상 법률관계에 관한 소송으로, 일반적으로 행정소송법상 제도로 규율된다.",
    answer: true,
    explanation: "취소소송·무효등 확인과 함께 행정소송의 유형으로 구분해 암기하는 것이 좋다."
  },
  {
    id: "q21",
    examId: "grade7",
    year: 2025,
    exam: "7급·9급",
    topic: "행정법 일반",
    statement: "평등원칙은 무조건 동일대우만을 요구하며 차별은 항상 위법이다.",
    answer: false,
    explanation: "합리적 이유가 있는 차별은 허용될 수 있고, 평등은 '잘못된 차별의 금지'에 가깝다."
  },
  {
    id: "q22",
    examId: "grade5",
    year: 2024,
    exam: "5급·일반",
    topic: "비례원칙",
    statement: "비례원칙은 목적의 정당성, 수단의 적합성, 침해의 최소성, 법익의 균형성 등을 포함하는 실질적 법원칙이다.",
    answer: true,
    explanation: "기본권 제한·행정작용의 재량 통제에 널리 적용된다."
  },
  {
    id: "q23",
    examId: "lawyer",
    year: 2026,
    exam: "변호사",
    topic: "행정행위",
    statement: "부작위 위법확인소송은 행정청이 법률상 작위의무가 있음에도 이를 이행하지 않는 경우 그 위법성의 확인을 구할 수 있는 소송이다.",
    answer: true,
    explanation: "작위소송과의 관계, 요건이 시험의 단골이다."
  },
  {
    id: "q24",
    examId: "grade7",
    year: 2024,
    exam: "7급·9급",
    topic: "행정소송",
    statement: "재항고는 제1심 행정법원의 결정에 대한 불복으로 대법원에 제기한다.",
    answer: true,
    explanation: "행정소송법상 불복구조(항소·상고·재항고)와 구분해 둔다."
  },
  {
    id: "q25",
    examId: "grade5",
    year: 2023,
    exam: "5급·일반",
    topic: "행정계약",
    statement: "행정계약은 항상 민법의 계약원칙만 적용되고 공법은 적용되지 않는다.",
    answer: false,
    explanation: "행정계약은 대체적 법적 성질 논의가 있으나 행정목적·공법적 제한이 개입한다."
  },
  {
    id: "q26",
    examId: "lawyer",
    year: 2025,
    exam: "변호사",
    topic: "행정절차",
    statement: "행정절차상 이해관계인에게 절차의 진행을 알릴 의무(통지 등)는 절차적 정당성과 관련된다.",
    answer: true,
    explanation: "절차적 권리보장·방어권과 연결된다."
  },
  {
    id: "q27",
    examId: "grade7",
    year: 2026,
    exam: "7급·9급",
    topic: "국가배상",
    statement: "국가배상법상 손해배상청구는 반드시 민사소송으로만 할 수 있다.",
    answer: false,
    explanation: "심의 전치·소송 제기 등 절차 규정을 함께 확인해야 한다."
  },
  {
    id: "q28",
    examId: "grade5",
    year: 2025,
    exam: "5급·일반",
    topic: "행정행위",
    statement: "하자가 중대하고 명백한 행정행위는 무효로 볼 수 있으나, 그 판단은 구체적 사안에 따른다.",
    answer: true,
    explanation: "무효와 취소 가능한 하자의 구별이 핵심이다."
  },
  {
    id: "q29",
    examId: "lawyer",
    year: 2024,
    exam: "변호사",
    topic: "행정소송",
    statement: "항고소송의 제소기간을 도과한 경우 원칙적으로 소의 이익이 없어 각하될 수 있다.",
    answer: true,
    explanation: "제소기간은 불변기간에 해당하여 엄격히 심리된다."
  },
  {
    id: "q30",
    examId: "grade7",
    year: 2025,
    exam: "7급·9급",
    topic: "행정법 일반",
    statement: "신뢰보호의 원칙은 행정의 법적 안정성과 국민의 정당한 신뢰를 보호하기 위한 원칙이다.",
    answer: true,
    explanation: "철회·취소·입법의 소급 등에서 자주 쟁점이 된다."
  },
  {
    id: "q31",
    examId: "grade5",
    year: 2024,
    exam: "5급·일반",
    topic: "행정소송",
    statement: "형식적 당사자소송에서 피고로 적격 있는 자는 행정청이 아닌 사인일 수 있다.",
    answer: true,
    explanation: "형식적 당사자소송의 구조(피고가 사인으로 보이는 경우)를 묻는 문제가 나온다."
  },
  {
    id: "q32",
    examId: "lawyer",
    year: 2025,
    exam: "변호사",
    topic: "비례원칙",
    statement: "침해의 최소성은 동일한 목적을 달성할 수 있는 여러 수단 중 개인의 자유·재산을 가장 덜 제한하는 수단을 선택해야 한다는 뜻이다.",
    answer: true,
    explanation: "비례원칙의 한 하위원칙이다."
  },
  {
    id: "q33",
    examId: "grade7",
    year: 2024,
    exam: "7급·9급",
    topic: "행정행위",
    statement: "기속행위와 재량행위의 구분은 행정청의 판단 여유 유무와 구제방법에 영향을 줄 수 있다.",
    answer: true,
    explanation: "재량권 일탈·남용이 취소사유로 논의된다."
  },
  {
    id: "q34",
    examId: "grade5",
    year: 2026,
    exam: "5급·일반",
    topic: "행정절차",
    statement: "행정절차법의 적용배제·특례 규정은 없으며 모든 행정작용에 동일하게 적용된다.",
    answer: false,
    explanation: "적용 제외·다른 법률과의 관계 조항이 존재한다."
  },
  {
    id: "q35",
    examId: "lawyer",
    year: 2023,
    exam: "변호사",
    topic: "국가배상",
    statement: "공무원이 고의로 타인에게 손해를 가한 경우에도 국가배상법상 국가책임이 성립할 수 있는지는 요건에 따라 판단된다.",
    answer: true,
    explanation: "직무관련성·고의·과실 등 구체 요건을 사례와 함께 공부하는 것이 좋다."
  }
];

window.QUESTION_BANK_STATIC = window.QUESTION_BANK.slice();

if (typeof window.refreshExamCatalogFromQuestionBank === "function") {
  window.refreshExamCatalogFromQuestionBank();
}
