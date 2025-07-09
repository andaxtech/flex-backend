import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const questions = [
  {
    id: 'q1',
    emoji: '🍕',
    scenario: 'You arrive at a locked gate and cannot reach the customer.',
    options: [
      { text: 'Leave the pizza on the ground.', isCorrect: false },
      { text: 'Call the customer for instructions.', isCorrect: true },
    ],
  },
  {
    id: 'q2',
    emoji: '🍄',
    scenario: 'You’re running 10 minutes late due to traffic.',
    options: [
      { text: 'Ignore it and continue driving.', isCorrect: false },
      { text: 'Send an update to the customer.', isCorrect: true },
    ],
  },
];

export default function TrainingGameScreen() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [finished, setFinished] = useState(false);

  const handleAnswer = (isCorrect) => {
    if (isCorrect) {
      setScore(score + 1);
      Alert.alert('Correct!', 'That was the right action.');
    } else {
      Alert.alert('Incorrect', 'Try to think about customer communication.');
    }

    const nextIndex = currentIndex + 1;
    if (nextIndex < questions.length) {
      setCurrentIndex(nextIndex);
    } else {
      setFinished(true);
    }
  };

  if (finished) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.title}>Training Complete!</Text>
        <Text style={styles.result}>Your Score: {score} / {questions.length}</Text>
        <Text style={styles.result}>{score === questions.length ? 'Great job! ✅' : 'Please review missed scenarios.'}</Text>
      </SafeAreaView>
    );
  }

  const current = questions[currentIndex];

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.emoji}>{current.emoji}</Text>
      <Text style={styles.scenario}>{current.scenario}</Text>
      {current.options.map((option, idx) => (
        <TouchableOpacity
          key={idx}
          style={styles.button}
          onPress={() => handleAnswer(option.isCorrect)}>
          <Text style={styles.buttonText}>{option.text}</Text>
        </TouchableOpacity>
      ))}
      <Text style={styles.progress}>Question {currentIndex + 1} of {questions.length}</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#f9f9f9',
    justifyContent: 'center',
  },
  emoji: {
    fontSize: 80,
    textAlign: 'center',
    marginBottom: 20,
  },
  scenario: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 20,
    color: '#333',
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#0055ff',
    padding: 15,
    borderRadius: 10,
    marginVertical: 10,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
  },
  progress: {
    marginTop: 20,
    textAlign: 'center',
    color: '#888',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 10,
  },
  result: {
    fontSize: 18,
    textAlign: 'center',
    marginVertical: 5,
  },
});
