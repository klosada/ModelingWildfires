import numpy as np
import random

"""Another version of ignition model we could use
This is based on the summary Thanawit put together.
"""


def ignition_probability(fuel_load, fuel_moisture, temperature, lightning_risk, human_activity):
    """Calculates the probability of ignition based on input factors."""

    # Example coefficients (replace with actual values)
    b0, b1, b2, b3, b4 = -2, 0.5, -0.8, 1.2, 0.7

    linear_combination = b0 + b1*fuel_load + b2*fuel_moisture + \
        b3*temperature + b4*lightning_risk + human_activity
    probability = 1 / (1 + np.exp(-linear_combination))
    return probability


def simulate_ignition(grid_size, fuel_data, weather_data, ignition_sources_data):
    """Simulates wildfire ignition across a grid."""

    ignition_map = np.zeros(grid_size)

    for i in range(grid_size[0]):
        for j in range(grid_size[1]):
            fuel_load = fuel_data[i, j]['load']
            fuel_moisture = weather_data[i, j]['moisture']
            temperature = weather_data[i, j]['temperature']
            lightning_risk = ignition_sources_data[i, j]['lightning']
            human_activity = ignition_sources_data[i, j]['human']

            prob = ignition_probability(
                fuel_load, fuel_moisture, temperature, lightning_risk, human_activity)

            if random.random() < prob:
                ignition_map[i, j] = 1  # Ignition occurs

    return ignition_map
