import QATable from '../QATable';

export default function QATableExample() {
  const qaPairs = [
    {
      id: '1',
      question: 'Does your platform support integration with SAP?',
      answer: 'Yes, we have a native SAP connector that syncs data bi-directionally in real-time',
      asker: 'Mike Chen',
      company: 'LogiTech Solutions'
    },
    {
      id: '2',
      question: 'What is the typical implementation timeline?',
      answer: 'For a standard deployment, we typically complete implementation in 4-6 weeks',
      asker: 'Sarah Parker',
      company: 'TransGlobal'
    },
    {
      id: '3',
      question: 'Can we customize the reporting dashboards?',
      answer: 'Absolutely, our platform includes a drag-and-drop dashboard builder',
      asker: 'David Lee',
      company: 'FreshFoods Inc'
    },
  ];

  return (
    <div className="p-6">
      <QATable qaPairs={qaPairs} />
    </div>
  );
}
