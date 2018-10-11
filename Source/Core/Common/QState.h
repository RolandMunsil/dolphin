#pragma once

#include <unordered_map>

#include "Common/CommonTypes.h"

enum class Action
{
  SHARP_TURN_LEFT,
  SOFT_TURN_LEFT,
  FORWARD,
  SOFT_TURN_RIGHT,
  SHARP_TURN_RIGHT,

  BOOST_AND_SHARP_TURN_LEFT,
  BOOST_AND_SOFT_TURN_LEFT,
  BOOST_AND_FORWARD,
  BOOST_AND_SOFT_TURN_RIGHT,
  BOOST_AND_SHARP_TURN_RIGHT,

  DRIFT_AND_SHARP_TURN_LEFT,
  DRIFT_AND_SHARP_TURN_RIGHT,

  // Used so we know the number of actions
  ACTIONS_COUNT
};

const std::unordered_map<Action, std::string> ACTION_NAMES = {
    {Action::SHARP_TURN_LEFT, "Sharp turn left"},
    {Action::SOFT_TURN_LEFT, "Soft turn left"},
    {Action::FORWARD, "Forward"},
    {Action::SOFT_TURN_RIGHT, "Soft turn right"},
    {Action::SHARP_TURN_RIGHT, "Sharp turn right"},

    {Action::BOOST_AND_SHARP_TURN_LEFT, "Boost+Sharp turn left"},
    {Action::BOOST_AND_SOFT_TURN_LEFT, "Boost+Soft turn left"},
    {Action::BOOST_AND_FORWARD, "Boost+Forward"},
    {Action::BOOST_AND_SOFT_TURN_RIGHT, "Boost+Soft turn right"},
    {Action::BOOST_AND_SHARP_TURN_RIGHT, "Boost+Sharp turn right"},

    {Action::DRIFT_AND_SHARP_TURN_LEFT, "Drift left"},
    {Action::DRIFT_AND_SHARP_TURN_RIGHT, "Drift right"}};

static const float INITIAL_ACTION_SCORE = 0;
class QState
{
private:
  float action_scores[(u32)Action::ACTIONS_COUNT];

  void GetBestActionAndScore(Action* best_action, float* best_score)
  {
    *best_score = -FLT_MAX;
    *best_action = (Action)-1;

    for (u32 i = 0; i < (u32)Action::ACTIONS_COUNT; i++)
    {
      if (action_scores[i] > *best_score)
      {
        *best_score = action_scores[i];
        *best_action = (Action)i;
      }
    }
  }

public:
  QState() { std::fill_n(action_scores, (u32)Action::ACTIONS_COUNT, INITIAL_ACTION_SCORE); }

  float ScoreForAction(Action action) { return action_scores[(u32)action]; }

  void SetActionScore(Action action, float score) { action_scores[(u32)action] = score; }

  Action BestAction()
  {
    float best_score;
    Action best_action;
    GetBestActionAndScore(&best_action, &best_score);
    return best_action;
  }

  float BestScore()
  {
    float best_score;
    Action best_action;
    GetBestActionAndScore(&best_action, &best_score);
    return best_score;
  }
};
