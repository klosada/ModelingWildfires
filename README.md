# Modeling Wildfire Spread in California with Cellular Automata 
## CSE 6730 Spring 2025
## Group 4
Team Member
- Gabriel Appiah
- Katherine Losada
- Kshitij Sawant
- Thanawit Suwannikom

## Project Description

### Abstract
This project develops a simulation framework to model wildfire spread in California using cellular automata by discretizing a geographical area into grid cells. By classifying each cell into one of four states—no fuel/vegetation, contains fuel but not ignited, burning, and burned completely—the algorithm updates cell states in discrete time steps based on local interactions. Our cellular automata approach employs state transition rules influenced by factors such as vegetation type, density, wind dynamics, and terrain elevation. This enables the model to capture the complex behavior of wildfire propagation with near real-time accuracy. Although our primary goal is on refining the wildfire spread simulation, we plan to expand the project to include emergency response optimization by integrating resource allocation if time permits. This project aims to provide emergency responders and environmental agencies with a robust predictive tool for understanding fire behavior and making informed decisions during wildfire events.  

### System
The system divides a geographical area into a discrete grid-based structure, where each cell represents a specific location with states such as free land, vegetation, burning, or burned. The wildfire propagation is governed by state transition rules, which determine how fire spreads based on neighboring cell conditions. To enhance accuracy, the model integrates real-world environmental data from Google Maps API for elevation and land characteristics and Weather API for real-time wind speed and direction. Using the Alexandridis et al. [20] mathematical model, the system calculates the probability of fire spread by incorporating factors such as vegetation type, density, wind influence, and topography, making it a realistic and dynamic simulation tool. 

The simulation runs in discrete time steps, continuously updating the wildfire spread based on evolving conditions. By leveraging graphical visualization, the system provides emergency responders, researchers, and environmental agencies with critical insights into fire behavior, allowing them to anticipate fire movements and plan mitigation strategies. The tool's ability to process real-time data enhances its potential for early warning systems and disaster response planning.

### Conceptual Model of the System
We develop a CA model that uses mathematical foundations for modeling the propagation of wildfire spread across a landscape like the one created by Velásquez et al. As part of this CA model, we structure the landscape into a grid, with each cell representing a small section. These grids can exist in four states: 1 = no fuel/vegetation, 2 = contains fuel but not ignited, 3 = burning, and 4 = burned completely. The fire spreads across the grid following a set of transition rules for each discretized time step. Based on environmental conditions and probability calculations, these rules determine whether neighboring cells catch fire. The transition rules are applied based on the Moore Neighborhood (a central cell with its eight surrounding neighbors).

### Platform
The system is primarily built using Python, leveraging libraries such as NumPy for matrix-based fire propagation modeling, Matplotlib for visualization, and Requests for API integration with external data sources like Google Maps API for geographical data and OpenWeather API for real-time weather conditions. The simulation can be executed in Jupyter Notebook or as a standalone Python application, making it highly flexible for research and operational use. Additionally, the tool can be extended with GIS software such as QGIS for spatial analysis and Google Earth Engine for real-time terrain and vegetation monitoring. For large-scale simulations, parallel computing frameworks like Dask or CUDA (for GPU acceleration) can be incorporated to improve performance. Furthermore, for web-based deployment, Flask or Django can be used to create an interactive user interface, allowing emergency responders to access fire simulation results remotely. The combination of these platforms ensures that the system remains scalable, accurate, and adaptable for various wildfire prediction and management needs. 

## Progress
March 14, 2025
Build a baseline model based on Velásquez et al. using Python script and try adding vegetation index using Satellite Imagery from Google Earth Engine and elevation of the area using Google Map Elevation API.

## Results
- Higher IoU (0.5285) was achieved for the Rabbit Fire, indicating moderate alignment between simulated and real burnt areas.
- Simulation showed faster wildfire spread in high-density forest areas, especially when aligned with wind direction.
- Slope and vegetation significantly influence both speed and direction of fire propagation.
