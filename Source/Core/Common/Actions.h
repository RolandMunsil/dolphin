#pragma once

#include <unordered_map>

#include "Common/CommonTypes.h"
#include "Common/MsgHandler.h"

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

class ActionHelper
{
public:
  static std::string GetActionName(Action action) { return ACTION_NAMES.at(action); }

  static GCPadStatus GenerateInputsFromAction(Action action)
  {
    GCPadStatus pad = {};

    // Always be accelerating
    pad.button = PAD_BUTTON_A;
    pad.analogA = 0xFF;

    // Don't change the camera
    pad.substickX = GCPadStatus::C_STICK_CENTER_X;
    pad.substickY = GCPadStatus::C_STICK_CENTER_Y;

    // Don't tilt forward or back
    pad.stickY = GCPadStatus::MAIN_STICK_CENTER_Y;

    // Boost
    if (action == Action::BOOST_AND_FORWARD || action == Action::BOOST_AND_SOFT_TURN_RIGHT ||
        action == Action::BOOST_AND_SOFT_TURN_LEFT ||
        action == Action::BOOST_AND_SHARP_TURN_RIGHT || action == Action::BOOST_AND_SHARP_TURN_LEFT)
    {
      pad.button |= PAD_BUTTON_Y;
    }

    // Triggers
    if (action == Action::DRIFT_AND_SHARP_TURN_RIGHT || action == Action::DRIFT_AND_SHARP_TURN_LEFT)
    {
      pad.triggerLeft = 0xFF;
      pad.triggerRight = 0xFF;
    }
    else
    {
      pad.triggerLeft = 0;
      pad.triggerRight = 0;
    }

    // Control stick
    float stick_x_value;
    switch (action)
    {
    case Action::FORWARD:
    case Action::BOOST_AND_FORWARD:
    {
      stick_x_value = 0;
      break;
    }
    case Action::SOFT_TURN_RIGHT:
    case Action::BOOST_AND_SOFT_TURN_RIGHT:
    {
      stick_x_value = 0.5;
      break;
    }
    case Action::SOFT_TURN_LEFT:
    case Action::BOOST_AND_SOFT_TURN_LEFT:
    {
      stick_x_value = -0.5;
      break;
    }
    case Action::SHARP_TURN_RIGHT:
    case Action::BOOST_AND_SHARP_TURN_RIGHT:
    case Action::DRIFT_AND_SHARP_TURN_RIGHT:
    {
      stick_x_value = 1.0;
      break;
    }
    case Action::SHARP_TURN_LEFT:
    case Action::BOOST_AND_SHARP_TURN_LEFT:
    case Action::DRIFT_AND_SHARP_TURN_LEFT:
    {
      stick_x_value = -1.0;
      break;
    }
    default:
    {
      PanicAlert("Invalid action");
      stick_x_value = 0;
    }
    }

    pad.stickX = static_cast<u8>(GCPadStatus::MAIN_STICK_CENTER_X +
                                 (stick_x_value * GCPadStatus::MAIN_STICK_RADIUS));

    return pad;
  }
};

static const float INITIAL_ACTION_SCORE = 0;
class ScoredActions
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
  ScoredActions() { std::fill_n(action_scores, (u32)Action::ACTIONS_COUNT, INITIAL_ACTION_SCORE); }

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
