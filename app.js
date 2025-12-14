const { useState } = React;

function App() {
  const [step, setStep] = useState(0);
  const [boardingPass, setBoardingPass] = useState(null);
  const [bagTag, setBagTag] = useState(null);
  const [dimensions, setDimensions] = useState(null);
  const [decision, setDecision] = useState(null);

  function simulateScan(label) {
    // In a real app, you would use the camera and barcode scanning library.
    return prompt(`Enter ${label}`);
  }

  const scanBoardingPass = () => {
    const bp = simulateScan('boarding pass code');
    if (bp) {
      setBoardingPass(bp);
      setStep(1);
    }
  };

  const scanBagTag = () => {
    const tag = simulateScan('bag tag');
    if (tag) {
      setBagTag(tag);
      setStep(2);
    }
  };

  const scanDimensions = () => {
    const l = parseFloat(prompt('Enter length (cm)'));
    const w = parseFloat(prompt('Enter width (cm)'));
    const h = parseFloat(prompt('Enter height (cm)'));
    if (!isNaN(l) && !isNaN(w) && !isNaN(h)) {
      setDimensions({ length: l, width: w, height: h });
      // Example decision logic: allowed dimensions 55 x 40 x 20 cm
      const allowed = { length: 55, width: 40, height: 20 };
      if (l <= allowed.length && w <= allowed.width && h <= allowed.height) {
        setDecision('APPROVED');
      } else {
        setDecision('REFUSED');
      }
      setStep(3);
    }
  };

  return (
    React.createElement('div', { className: 'app' },
      React.createElement('h1', null, 'BagCheck Mobile'),
      step === 0 && React.createElement('button', { onClick: scanBoardingPass }, 'Scan Boarding Pass'),
      step === 1 && React.createElement('button', { onClick: scanBagTag }, 'Scan Bag Tag'),
      step === 2 && React.createElement('button', { onClick: scanDimensions }, 'Scan Bag Dimensions'),
      step === 3 && React.createElement('div', null,
        React.createElement('p', null, `Boarding Pass: ${boardingPass}`),
        React.createElement('p', null, `Bag Tag: ${bagTag}`),
        React.createElement('p', null, `Dimensions: ${dimensions.length} x ${dimensions.width} x ${dimensions.height} cm`),
        React.createElement('h2', null, `Decision: ${decision}`)
      )
    )
  );
}

ReactDOM.render(React.createElement(App), document.getElementById('root'));
